"""常驻 TTS 守护进程：模型只加载一次，之后每个请求直接推理。

为什么要有它：原来的流程是「一个合成任务 = 起一个 WSL worker = 重新加载一次 CosyVoice3」，
每次冷加载约 80–100 秒。守护进程把模型常驻在显存里，请求来了直接算。

接口（HTTP，绑在 WSL 的 127.0.0.1，Windows 侧经端口转发访问）：
  GET  /health          -> {"ok": true, "style": "...", "device": "cuda", "uptime": 12.3}
  POST /speak           -> {"text": "...", "style": "gentle", "output_dir": "/mnt/..."}
                           成功返回 {"ok": true, "result": {...}}
                           失败返回 500 + {"ok": false, "error": "..."}

输出布局与 feiyu_runtime/tts.py 完全一致（native.wav / speech.wav / result.json），
所以调用方原有的校验逻辑不用改。
"""
import argparse
import json
import os
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True, type=Path)
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--port", type=int, default=9881)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    server_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(server_root))
    from feiyu_runtime.common import (
        apply_backend_env,
        checked_path,
        cpu_onnx_sessions,
        device_type,
        load,
        prepare,
        save,
        sha,
        verify_audio_library,
        verify_package,
        verify_repo,
    )

    package = args.package.resolve()
    profile = load(args.profile)
    if profile.get("engine") != "tts":
        raise ValueError("profile 不是 tts 引擎")
    manifest = verify_package(package)
    if manifest.get("schema") != "feiyu-voice-local-release-v1":
        raise ValueError("不支持的 TTS 包")
    repo = verify_repo(profile)

    os.environ.update(
        HF_HUB_OFFLINE="1",
        TRANSFORMERS_OFFLINE="1",
        PYTHONDONTWRITEBYTECODE="1",
        OMP_NUM_THREADS="4",
    )
    apply_backend_env(profile)
    os.chdir(repo)
    sys.path[:0] = [str(repo), str(repo / "third_party/Matcha-TTS")]

    import numpy as np
    import soundfile as sf
    import torch
    import onnxruntime as ort
    from cosyvoice.cli.cosyvoice import AutoModel
    from cosyvoice.utils.common import set_all_random_seed

    info = prepare(torch, profile)
    verify_audio_library(profile)

    started = time.perf_counter()
    sessions = []
    with cpu_onnx_sessions(ort, sessions):
        voice = AutoModel(
            model_dir=str(checked_path(package, manifest["base_model_dir"])),
            fp16=False,
            load_trt=False,
            load_vllm=False,
        )
    params = manifest["inference"]
    set_all_random_seed(params["seed"])
    base_llm = checked_path(package, manifest["base_model_dir"]) / "llm.pt"
    state = {"style": None}
    lock = threading.Lock()
    boot_seconds = time.perf_counter() - started

    def ensure_style(style):
        """切声线：不同声线是不同 llm checkpoint，换的时候重载 state_dict。"""
        name = style if style in manifest["styles"] else manifest["default_style"]
        selected = manifest["styles"][name]
        checkpoint = checked_path(package, selected["llm_checkpoint"])
        reference = checked_path(package, selected["reference_audio"])
        if sha(checkpoint) != selected["llm_sha256"] or sha(reference) != selected["reference_sha256"]:
            raise ValueError("声线资源与 manifest 不一致")
        if state["style"] != name:
            if checkpoint != base_llm:
                sd = torch.load(checkpoint, map_location="cpu", weights_only=True)
                voice.model.llm.load_state_dict(sd, strict=True)
                del sd
            state["style"] = name
        return selected, reference

    def speak(body):
        text = str(body.get("text") or "").strip()
        if not text:
            raise ValueError("text 不能为空")
        style = body.get("style")
        out_dir = body.get("output_dir")
        if not out_dir:
            raise ValueError("output_dir 必填")

        with lock:
            selected, reference = ensure_style(style)
            out = Path(out_dir).resolve()
            if out.is_relative_to(package) or out == repo or repo.is_relative_to(out):
                raise ValueError("输出目录不能在包或运行时代码目录里")
            out.mkdir(parents=True, exist_ok=False)

            t0 = time.perf_counter()
            with torch.inference_mode():
                chunks = [
                    x["tts_speech"].detach().cpu().numpy()[0]
                    for x in voice.inference_zero_shot(
                        text,
                        params["prompt_prefix"] + selected["reference_text"],
                        str(reference),
                        stream=False,
                        speed=params["speed"],
                        text_frontend=True,
                    )
                ]
            if not chunks:
                raise ValueError("TTS returned no audio")
            audio = np.concatenate(chunks)
            if len(audio) <= 2400 or not np.isfinite(audio).all() or abs(audio).max() <= 1e-4:
                raise ValueError("Invalid TTS output")

            sf.write(out / "native.wav", audio, voice.sample_rate, subtype="FLOAT")
            gain = min(1.0, 0.98 / float(abs(audio).max()))
            sf.write(out / "speech.wav", audio * gain, voice.sample_rate, subtype="PCM_16")
            receipt = dict(
                status="success",
                playback_sha256=sha(out / "speech.wav"),
                output_sha256=sha(out / "native.wav"),
                sample_rate=voice.sample_rate,
                seconds=len(audio) / voice.sample_rate,
                playback_gain=gain,
                runtime=info,
                onnx_sessions=sessions,
                actual_text_frontend=voice.frontend.text_frontend,
                checkpoint_sha256=sha(checked_path(package, selected["llm_checkpoint"])),
                elapsed_seconds=time.perf_counter() - t0,
                runtime_rvc=False,
            )
            save(out / "result.json", receipt)
            return receipt

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _send(self, code, payload):
            raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path.split("?")[0] != "/health":
                return self._send(404, {"ok": False, "error": "not-found"})
            self._send(200, {
                "ok": True,
                "style": state["style"],
                "device": device_type(info["backend"]),
                "boot_seconds": round(boot_seconds, 1),
                "uptime": round(time.perf_counter() - started, 1),
            })

        def do_POST(self):
            if self.path.split("?")[0] != "/speak":
                return self._send(404, {"ok": False, "error": "not-found"})
            try:
                length = int(self.headers.get("content-length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                receipt = speak(body)
                self._send(200, {"ok": True, "result": receipt})
            except Exception as exc:  # 请求级失败不该带崩守护进程
                self._send(500, {"ok": False, "error": str(exc), "trace": traceback.format_exc()[-1200:]})

        def log_message(self, fmt, *a):
            sys.stderr.write("[daemon] " + fmt % a + "\n")

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    sys.stderr.write(
        f"[daemon] ready on {args.host}:{args.port} · device={device_type(info['backend'])} "
        f"· boot={boot_seconds:.1f}s · styles={list(manifest['styles'])}\n"
    )
    sys.stderr.flush()
    httpd.serve_forever()


if __name__ == "__main__":
    main()
