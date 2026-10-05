"""PROTOTYPE: verify Youdao REST image rendering, never production code."""

import argparse
import base64
import getpass
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
ENDPOINT = "https://openapi.youdao.com/ocrtransapi"
LANGUAGES = {"en": "英语", "ja": "日语", "ko": "韩语", "es": "西班牙语"}
SAMPLE_NAMES = ["single", "columns", "illustrated", "screenshot", "long", "dim-photo"]
DISHES = [("宫保鸡丁", "38"), ("麻婆豆腐", "22"), ("番茄炒蛋", "18"),
          ("清蒸鲈鱼", "68"), ("鱼香肉丝", "32"), ("夫妻肺片", "42"),
          ("蚂蚁上树", "28"), ("蒜蓉西兰花", "26")]


def font(size):
    candidates = [os.environ.get("PROTOTYPE_FONT", ""),
                  "/System/Library/Fonts/STHeiti Medium.ttc",
                  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]
    for name in candidates:
        if name and Path(name).exists():
            return ImageFont.truetype(name, size)
    raise SystemExit("设置 PROTOTYPE_FONT 为可用的中文字体路径。")


def make_samples():
    dest = ROOT / "samples"
    dest.mkdir(exist_ok=True)
    records = []
    for name in SAMPLE_NAMES:
        width, height = (900, 1200) if name != "long" else (900, 4800)
        im = Image.new("RGB", (width, height), "#f8f2e6")
        d = ImageDraw.Draw(im)
        d.text((55, 50), "中文菜单 · 原型测试", font=font(43), fill="#192c23")
        d.text((55, 120), "合成样本，价格仅用于测试", font=font(26), fill="#68716b")
        expected = []
        count = 32 if name == "long" else 8
        for i in range(count):
            dish, price = DISHES[i % len(DISHES)]
            if name == "columns":
                x, y, row_width = 45 + (i // 4) * 450, 220 + (i % 4) * 210, 360
            else:
                x, y, row_width = 55, 225 + i * (140 if name == "long" else 112), 780
            if name == "illustrated":
                # Deliberately simple illustration, not a food photograph.
                d.ellipse((x, y, x + 78, y + 72), fill="#e8d8b2", outline="#777b66", width=3)
                d.ellipse((x + 15, y + 20, x + 65, y + 52), fill="#79916f")
                x += 105
                row_width -= 105
            size = 36 if name == "columns" else 40
            d.text((x, y), dish, font=font(size), fill="#18291f")
            price_x = x + row_width - 115
            d.text((price_x, y), "¥" + price, font=font(34), fill="#18291f")
            d.line((x, y + 75, x + row_width, y + 75), fill="#cecbbf", width=2)
            expected.append({"dish": dish, "price": price, "dish_box": [x, y, price_x - x - 15, 60],
                             "price_box": [price_x, y, 110, 60]})
        if name == "screenshot":
            d.rectangle((0, height - 95, width, height), fill="#223c2b")
            d.text((50, height - 72), "购物车 0 · 去结算", font=font(34), fill="white")
        if name == "dim-photo":
            im = ImageEnhance.Brightness(im).enhance(0.68)
            im = im.filter(ImageFilter.GaussianBlur(0.65)).rotate(4, expand=False, fillcolor="#665e51")
        path = dest / (name + ".png")
        im.save(path)
        records.append({"sample_id": name, "file": path.name, "size": [width, height],
                        "source": "本地程序生成；不是餐厅菜单、真实拍摄或菜品照片",
                        "annotations_coordinate_space": "旋转前画布" if name == "dim-photo" else "输入图片",
                        "expected": expected})
    (dest / "manifest.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n")
    long_image = Image.open(dest / "long.png")
    cuts = [0, 1275, 2395, 3515, 4800]
    for i, (start, end) in enumerate(zip(cuts, cuts[1:])):
        long_image.crop((0, start, 900, end)).save(dest / f"long-tile-{i}.png")
    print("已生成 6 张合成样本（含插图，不含真实菜品照片）。", flush=True)


def image_fields(value, prefix=""):
    found = []
    if isinstance(value, dict):
        for key, item in value.items():
            found += image_fields(item, f"{prefix}.{key}" if prefix else key)
    elif isinstance(value, list):
        for i, item in enumerate(value):
            found += image_fields(item, f"{prefix}[{i}]")
    elif isinstance(value, str) and len(value) > 200:
        try:
            encoded = value.split(",", 1)[1] if value.startswith("data:image/") else value
            raw = base64.b64decode(encoded, validate=True)
            image = Image.open(io.BytesIO(raw))
            image.load()
            found.append((prefix, raw, image.size, image.format))
        except (ValueError, OSError):
            pass
    return found


def call_api(path, language, app_key, secret, args, output):
    request_id = f"{path.stem}-{language}-r{args.render}-{uuid.uuid4().hex[:8]}"
    started = time.perf_counter()
    raw = path.read_bytes()
    source = Image.open(io.BytesIO(raw))
    source.load()
    q = base64.b64encode(raw).decode("ascii")
    if len(q) >= 5_000_000:
        raise SystemExit("Base64 超出原型的保守 5MB 上限；请先缩图或切片。")
    salt, curtime = uuid.uuid4().hex, str(int(time.time()))
    sign_input = q if len(q) <= 20 else q[:10] + str(len(q)) + q[-10:]
    sign = hashlib.sha256((app_key + sign_input + salt + curtime + secret).encode()).hexdigest()
    params = {"type": "1", "q": q, "from": "zh-CHS", "to": language,
              "appKey": app_key, "salt": salt, "curtime": curtime, "sign": sign,
              "signType": "v3", "docType": "json", "render": str(args.render),
              "translateOption": str(args.model)}
    body = urllib.parse.urlencode(params).encode("ascii")
    prepared = time.perf_counter()
    row = {"request_id": request_id, "started_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "sample_id": path.stem, "language": language, "source_size": list(source.size),
           "source_bytes": len(raw), "base64_bytes": len(q), "form_bytes": len(body),
           "source_sha256": hashlib.sha256(raw).hexdigest(), "render": args.render, "model": args.model,
           "preprocess_ms": round((prepared - started) * 1000, 1),
           "python": platform.python_version(), "platform": platform.platform(),
           "network": "本机当前网络；未采集运营商/带宽；未经过小程序或 CloudBase", "concurrency": 1}
    try:
        req = urllib.request.Request(ENDPOINT, data=body,
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=90, context=ssl.create_default_context()) as response:
            response_raw = response.read()
            row["http_status"] = response.status
        received = time.perf_counter()
        data = json.loads(response_raw)
        row.update({"api_ms": round((received - prepared) * 1000, 1),
                    "response_bytes": len(response_raw), "error_code": str(data.get("errorCode", "missing")),
                    "top_level_fields": list(data), "lan_from": data.get("lanFrom"), "lan_to": data.get("lanTo"),
                    "orientation": data.get("orientation"), "text_angle": data.get("textAngle"),
                    "region_count": len(data.get("resRegions", [])), "supplier_request_id": data.get("RequestId"),
                    "reported_image_size": data.get("image_size"), "aigc": data.get("AIGC")})
        found = image_fields(data)
        row["images"] = []
        for i, (field, image_raw, size, image_format) in enumerate(found):
            suffix = {"JPEG": "jpg", "PNG": "png"}.get(image_format, image_format.lower())
            image_name = f"{request_id}-{i}.{suffix}"
            (output / image_name).write_bytes(image_raw)
            row["images"].append({"field": field, "file": image_name, "size": list(size),
                                  "format": image_format, "bytes": len(image_raw)})
            # Keep the response inspectable without duplicating large binary data.
            data = redact_image(data, field, image_raw, size, image_format)
        row["regions"] = data.get("resRegions", [])
        row["status"] = "image_ready" if row["error_code"] == "0" and found else (
            "text_only" if row["error_code"] == "0" else "api_error")
        (output / f"{request_id}.response.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        row.update({"status": "transport_error", "error_type": type(exc).__name__})
    row["ready_ms"] = round((time.perf_counter() - started) * 1000, 1)
    with (output / "requests.jsonl").open("a") as fp:
        fp.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(json.dumps({k: row.get(k) for k in ["request_id", "status", "error_code", "api_ms", "ready_ms",
                                           "region_count", "images"]}, ensure_ascii=False), flush=True)
    return row


def redact_image(value, field, image_raw, size, image_format, prefix=""):
    if prefix == field:
        return {"binary_removed": True, "bytes": len(image_raw), "size": list(size), "format": image_format}
    if isinstance(value, dict):
        return {k: redact_image(v, field, image_raw, size, image_format, f"{prefix}.{k}" if prefix else k)
                for k, v in value.items()}
    if isinstance(value, list):
        return [redact_image(v, field, image_raw, size, image_format, f"{prefix}[{i}]") for i, v in enumerate(value)]
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generate-samples", action="store_true")
    parser.add_argument("--image", type=Path)
    parser.add_argument("--sample", default="single")
    parser.add_argument("--languages", default="en")
    parser.add_argument("--render", type=int, choices=[0, 1], default=1)
    parser.add_argument("--model", type=int, choices=[0, 1, 2], default=0)
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--output", help="输出子目录；自带样本默认日期-smoke，自选图片默认 local-日期时间（Git 忽略）")
    parser.add_argument("--credentials-stdin", action="store_true", help="TTY 内关闭回显，读取一次临时 JSON 凭证")
    args = parser.parse_args()
    if args.generate_samples:
        make_samples()
        return
    if args.credentials_stdin:
        import termios
        previous = termios.tcgetattr(sys.stdin)
        hidden = list(previous)
        hidden[3] &= ~termios.ECHO
        termios.tcsetattr(sys.stdin, termios.TCSANOW, hidden)
        print("等待临时凭证（输入不回显、不落盘）。", flush=True)
        try:
            credentials = json.loads(sys.stdin.readline())
        finally:
            termios.tcsetattr(sys.stdin, termios.TCSANOW, previous)
        app_key, secret = credentials["appKey"], credentials["secret"]
    else:
        app_key = os.environ.get("YOUDAO_APP_KEY") or getpass.getpass("有道应用 ID：")
        secret = os.environ.get("YOUDAO_APP_SECRET") or getpass.getpass("有道应用密钥：")
    languages = args.languages.split(",")
    if not all(code in LANGUAGES for code in languages):
        raise SystemExit("目标语言使用 en,ja,ko,es。中文目标直接查看原图，不调用 API。")
    paths = [args.image] if args.image else (
        [ROOT / "samples" / (name + ".png") for name in SAMPLE_NAMES] if args.sample == "all" else
        [ROOT / "samples" / (name + ".png") for name in args.sample.split(",")])
    output_name = args.output or (time.strftime("local-%Y%m%d-%H%M%S") if args.image else
                                   time.strftime("%Y-%m-%d-smoke"))
    output = ROOT / "results" / output_name
    output.mkdir(parents=True, exist_ok=True)
    for _ in range(args.repeat):
        for path in paths:
            for language in languages:
                result = call_api(path, language, app_key, secret, args, output)
                if result.get("error_code") in {"108", "110", "111", "202", "203", "205", "401"}:
                    raise SystemExit("账户、授权或签名未通过；停止后续调用，见结果错误码。")
                time.sleep(1.2)


if __name__ == "__main__":
    main()
