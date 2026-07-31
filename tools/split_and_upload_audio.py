#!/usr/bin/env python3
"""
📂 tools/split_and_upload_audio.py

本機小工具：把「一次錄完好幾頁」的舊音檔，切成一頁一檔，
再直接上傳到指定學生的 Google Drive 資料夾（通常是 01_Submissions），
取代之前每次都要在對話裡請 Cursor 手動下 ffmpeg 指令的做法。

只依賴：Python 3 標準函式庫 + 系統的 ffmpeg（本機已確認有安裝）。
不會碰 Supabase／資料庫，也不會觸發 AI 批改——
那一步請在教師端「補啟 AI 批改」面板操作，或請 Cursor 幫忙補 raw_data.audio_segments。

──────────────────────────────────────────────────────────────
用法一：抓靜音空檔，找出建議切點（不會真的切檔）

    python3 tools/split_and_upload_audio.py detect \
        --audio "/path/to/long_recording.wav"

用法二：依切點清單切成好幾個檔案（不上傳）

    python3 tools/split_and_upload_audio.py split \
        --audio "/path/to/long_recording.wav" \
        --out "/path/to/output_dir" \
        --cuts "A_p1=0:00-0:47" "A_p2=0:47-1:33" "B_p1=1:33-2:15" "B_p2=2:15-2:50"

    （--cuts 也可以用純秒數：--cuts "A_p1=0-47.01" "A_p2=47.01-92.96"）

用法三：切好之後，依序上傳到指定的 Drive 資料夾

    python3 tools/split_and_upload_audio.py upload \
        --dir "/path/to/output_dir" \
        --folder-id "<學生 01_Submissions 的 Drive 資料夾 ID>"

用法四：一次切好＋上傳，並印出可以貼給 Cursor 的 JSON 摘要
        （方便接下來請 Cursor 幫忙補 task_completions.raw_data.audio_segments）

    python3 tools/split_and_upload_audio.py split-upload \
        --audio "/path/to/long_recording.wav" \
        --out "/path/to/output_dir" \
        --cuts "A_p1=0:00-0:47" "A_p2=0:47-1:33" "B_p1=1:33-2:15" "B_p2=2:15-2:50" \
        --folder-id "<學生 01_Submissions 的 Drive 資料夾 ID>"

Drive 資料夾 ID 怎麼找：打開該學生的 01_Submissions 資料夾，網址列
`https://drive.google.com/drive/folders/<這一段就是 folder-id>`。

⚠️ 鐵律（見 .cursor/rules/drive-folder-upload-invariants.mdc）：
    這個工具永遠不傳 subFolderName，一定是直接寫入你給的 folder-id，
    所以 folder-id 務必是該生的 01_Submissions，不要給錯成班級或學生根目錄，
    否則檔案一樣會長錯地方。
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import urllib.request
import urllib.error

GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwsunsD9BnK1DEdyXlT5OmH5j2t4vvDf6URWhfYzXoB3FjdLOPsCC4jTKjSK3Q2RmGO/exec'


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


def parse_timecode(s):
    """支援 '1:33' 或 '93' 或 '93.5' 這幾種寫法，回傳秒數（float）。"""
    s = s.strip()
    if ':' in s:
        parts = s.split(':')
        parts = [float(p) for p in parts]
        seconds = 0.0
        for p in parts:
            seconds = seconds * 60 + p
        return seconds
    return float(s)


def parse_cut_arg(raw):
    """把 'A_p1=0:00-0:47' 這種字串解析成 (name, start_sec, end_sec)。"""
    if '=' not in raw or '-' not in raw.split('=', 1)[1]:
        raise ValueError(f"--cuts 格式錯誤：{raw!r}，應為 名稱=開始-結束，例如 A_p1=0:00-0:47")
    name, range_part = raw.split('=', 1)
    start_str, end_str = range_part.rsplit('-', 1)
    return name.strip(), parse_timecode(start_str), parse_timecode(end_str)


def cmd_detect(args):
    """跑 ffmpeg silencedetect，列出偵測到的靜音區間，給人工判斷切點用。"""
    cmd = [
        'ffmpeg', '-i', args.audio,
        '-af', f'silencedetect=noise={args.noise_db}dB:d={args.min_silence}',
        '-f', 'null', '-'
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    lines = [l for l in proc.stderr.splitlines() if 'silence_' in l]
    if not lines:
        eprint('沒有偵測到符合門檻的靜音區間，可以調整 --noise-db（預設 -35）或 --min-silence（預設 0.35 秒）再試一次。')
        return
    print('偵測到的靜音區間（可能是頁與頁之間的空檔，僅供參考，請自行確認切點是否合理）：')
    for l in lines:
        print('  ' + l.strip())


def run_ffmpeg_cut(audio_path, start, end, out_path):
    """一律重新編碼成 WAV（不用 -c copy），確保任何來源格式（webm/m4a/mp3…）都能切得準。"""
    cmd = [
        'ffmpeg', '-y',
        '-ss', str(start), '-to', str(end),
        '-i', audio_path,
        '-ar', '44100', '-ac', '1',
        out_path
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f'ffmpeg 切割失敗（{out_path}）：\n{proc.stderr[-1200:]}')


def do_split(audio_path, cuts, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    results = []
    for name, start, end in cuts:
        safe_name = re.sub(r'[\\/:*?"<>|]', '_', name).strip() or 'segment'
        out_path = os.path.join(out_dir, f'{safe_name}.wav')
        eprint(f'切割 {safe_name}：{start:.2f}s ~ {end:.2f}s → {out_path}')
        run_ffmpeg_cut(audio_path, start, end, out_path)
        results.append({'label': name, 'start': start, 'end': end, 'path': out_path})
    return results


def cmd_split(args):
    cuts = [parse_cut_arg(c) for c in args.cuts]
    results = do_split(args.audio, cuts, args.out)
    print(f'✅ 已切出 {len(results)} 個檔案到 {args.out}')
    for r in results:
        print(f"  - {r['label']}: {r['path']}")


def upload_one_file(file_path, folder_id, assignment_id, task_id, gas_url):
    file_name = os.path.basename(file_path)
    lower = file_name.lower()
    if lower.endswith('.wav'):
        mime_type = 'audio/wav'
    elif lower.endswith('.mp3'):
        mime_type = 'audio/mpeg'
    elif lower.endswith('.m4a'):
        mime_type = 'audio/mp4'
    else:
        mime_type = 'application/octet-stream'

    with open(file_path, 'rb') as f:
        file_bytes = f.read()
    file_data_b64 = base64.b64encode(file_bytes).decode('ascii')

    payload = {
        'action': 'upload_file',
        'fileData': file_data_b64,
        'fileName': file_name,
        'mimeType': mime_type,
        'folderId': folder_id,
        # 故意不傳 subFolderName：直接寫入 folder_id 本身（見鐵律說明）。
    }
    if assignment_id:
        payload['assignmentId'] = assignment_id
    if task_id:
        payload['taskId'] = task_id

    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(gas_url, data=body, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            resp_body = resp.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode('utf-8')
    except urllib.error.URLError as e:
        raise RuntimeError(f'上傳失敗（連線錯誤）：{e}')

    try:
        result = json.loads(resp_body)
    except json.JSONDecodeError:
        raise RuntimeError(f'上傳失敗，GAS 回傳非 JSON：{resp_body[:500]}')

    if result.get('status') != 'success':
        raise RuntimeError(f'上傳失敗：{result.get("message", resp_body[:500])}')

    return result


def do_upload(file_paths, folder_id, assignment_id, task_id, gas_url):
    results = []
    for path in file_paths:
        eprint(f'上傳 {os.path.basename(path)} ...')
        result = upload_one_file(path, folder_id, assignment_id, task_id, gas_url)
        eprint(f"  ✅ fileId={result['fileId']}")
        results.append({'path': path, 'fileId': result['fileId'], 'fileUrl': result.get('fileUrl', '')})
    return results


def cmd_upload(args):
    files = sorted(
        os.path.join(args.dir, f) for f in os.listdir(args.dir)
        if f.lower().endswith(('.wav', '.mp3', '.m4a'))
    )
    if not files:
        eprint(f'{args.dir} 底下找不到 .wav/.mp3/.m4a 檔案。')
        sys.exit(1)
    results = do_upload(files, args.folder_id, args.assignment_id, args.task_id, args.gas_url)
    print(json.dumps(results, ensure_ascii=False, indent=2))


def cmd_split_upload(args):
    cuts = [parse_cut_arg(c) for c in args.cuts]
    split_results = do_split(args.audio, cuts, args.out)
    upload_results = do_upload(
        [r['path'] for r in split_results],
        args.folder_id, args.assignment_id, args.task_id, args.gas_url
    )

    summary = []
    for split_r, upload_r in zip(split_results, upload_results):
        summary.append({
            'label': split_r['label'],
            'start': split_r['start'],
            'end': split_r['end'],
            'fileId': upload_r['fileId'],
            'fileUrl': upload_r['fileUrl']
        })

    print('\n✅ 切割＋上傳完成！以下 JSON 可以直接貼給 Cursor，'
          '請它幫忙補進該筆 task_completions.raw_data.audio_segments 並觸發 AI 批改：\n')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def build_parser():
    parser = argparse.ArgumentParser(
        description='把一次錄完好幾頁的舊音檔切成一頁一檔，並可直接上傳到學生的 Drive 資料夾。'
    )
    sub = parser.add_subparsers(dest='cmd', required=True)

    p_detect = sub.add_parser('detect', help='偵測靜音空檔，列出建議切點（不切檔）')
    p_detect.add_argument('--audio', required=True, help='原始音檔路徑')
    p_detect.add_argument('--noise-db', type=float, default=-35, help='靜音判斷門檻 dB（預設 -35）')
    p_detect.add_argument('--min-silence', type=float, default=0.35, help='最短靜音秒數（預設 0.35）')
    p_detect.set_defaults(func=cmd_detect)

    p_split = sub.add_parser('split', help='依切點清單切成好幾個檔案')
    p_split.add_argument('--audio', required=True, help='原始音檔路徑')
    p_split.add_argument('--out', required=True, help='輸出資料夾')
    p_split.add_argument('--cuts', required=True, nargs='+', help='切點，例如 A_p1=0:00-0:47')
    p_split.set_defaults(func=cmd_split)

    p_upload = sub.add_parser('upload', help='把資料夾裡的音檔依檔名順序上傳到 Drive 資料夾')
    p_upload.add_argument('--dir', required=True, help='要上傳的音檔所在資料夾')
    p_upload.add_argument('--folder-id', required=True, help='目標 Drive 資料夾 ID（該生的 01_Submissions）')
    p_upload.add_argument('--assignment-id', default='', help='（可選）作業 ID，會寫進檔案描述')
    p_upload.add_argument('--task-id', default='', help='（可選）任務 ID，會寫進檔案描述')
    p_upload.add_argument('--gas-url', default=GAS_WEB_APP_URL, help='GAS Web App URL（預設用專案現有的）')
    p_upload.set_defaults(func=cmd_upload)

    p_su = sub.add_parser('split-upload', help='切割＋上傳一次做完，並印出摘要 JSON')
    p_su.add_argument('--audio', required=True, help='原始音檔路徑')
    p_su.add_argument('--out', required=True, help='輸出資料夾')
    p_su.add_argument('--cuts', required=True, nargs='+', help='切點，例如 A_p1=0:00-0:47')
    p_su.add_argument('--folder-id', required=True, help='目標 Drive 資料夾 ID（該生的 01_Submissions）')
    p_su.add_argument('--assignment-id', default='', help='（可選）作業 ID，會寫進檔案描述')
    p_su.add_argument('--task-id', default='', help='（可選）任務 ID，會寫進檔案描述')
    p_su.add_argument('--gas-url', default=GAS_WEB_APP_URL, help='GAS Web App URL（預設用專案現有的）')
    p_su.set_defaults(func=cmd_split_upload)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
