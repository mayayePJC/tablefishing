"""Build the original, packaged 120-second soundscapes without online services.

Requires numpy/scipy and soundfile (the latter may be installed into
work/ambient-tools with pip --target). Windows SAPI's installed Chinese Huihui
voice generates the fictional PA announcements; the game ships only the final
Ogg recordings and never invokes a voice engine at runtime.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent if ROOT.name == 'project' else ROOT
sys.path.insert(0, str(WORKSPACE / 'work' / 'ambient-tools'))
import numpy as np
from scipy import fft, signal
from scipy.io import wavfile
import soundfile as sf

SR = 32000
DURATION = 120
OVERLAP = 2
LENGTH = (DURATION + OVERLAP) * SR
SOURCE = WORKSPACE / 'work' / 'ambient-source'
ASSETS = ROOT / 'src' / 'renderer' / 'public' / 'audio'
QA = WORKSPACE / 'outputs' / 'v0.1.6-qa'
PA_INTERVAL = 60.0
PA_CUE_START = 0.15
PA_SPEECH_DELAY = 1.0
ANNOUNCEMENTS = [
    '旅客朋友们，请注意。海星航空，前往云海的一二六八次航班，现在开始登机。请您前往十二号登机口，出示登机牌，有序登机。谢谢。',
    '各位旅客，下午好。前往星港的远山航空，六零九次航班，即将开始登机。请携带好随身物品，前往二十三号登机口等候。祝您旅途愉快。',
    '我们先去找一下登机口吧。行李在这里。还有一点时间，坐下来休息一会儿。好，等一下。谢谢。'
]


def create_voices():
    SOURCE.mkdir(parents=True, exist_ok=True)
    manifest = [{'path': str(SOURCE / f'voice-{i + 1}.wav'), 'text': text}
                for i, text in enumerate(ANNOUNCEMENTS)]
    manifest_path = SOURCE / 'voice-script.json'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
    ps_manifest = str(manifest_path).replace("'", "''")
    # A direct, noninteractive COM command; no registry changes or .ps1 execution-policy changes.
    powershell = r'''
$ErrorActionPreference = 'Stop'
$voice = New-Object -ComObject SAPI.SpVoice
$chinese = @($voice.GetVoices() | Where-Object { $_.Id -match 'ZH-CN_HUIHUI' })
if ($chinese.Count -eq 0) { throw 'Chinese Huihui SAPI voice is not installed' }
$voice.Voice = $chinese[0]
$voice.Volume = 100
$voice.Rate = -1
$lines = Get-Content -Raw -Encoding UTF8 -LiteralPath 'MANIFEST_PATH' | ConvertFrom-Json
foreach ($line in $lines) {
  $stream = New-Object -ComObject SAPI.SpFileStream
  $stream.Format.Type = 22
  $stream.Open($line.path, 3, $false)
  $voice.AudioOutputStream = $stream
  [void]$voice.Speak($line.text, 0)
  $stream.Close()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($stream)
}
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($voice)
'''.replace('MANIFEST_PATH', ps_manifest)
    encoded = base64.b64encode(powershell.encode('utf-16le')).decode('ascii')
    completed = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
                               cwd=ROOT, capture_output=True)
    if completed.returncode:
        raise RuntimeError('Offline SAPI generation failed: ' + completed.stderr.decode('utf-8', errors='replace'))


def rms(a):
    return float(np.sqrt(np.mean(np.square(a, dtype=np.float64))))


def normalise(a, target):
    return np.asarray(a * (target / max(1e-9, rms(a))), dtype=np.float32)


def texture(seed, low, high, slope=0.0, length=LENGTH):
    rng = np.random.default_rng(seed)
    spectrum = fft.rfft(rng.standard_normal(length, dtype=np.float32))
    freq = fft.rfftfreq(length, 1 / SR).astype(np.float32)
    shape = (1 + (freq / high) ** 6) ** -0.5
    if low:
        shape *= (1 + (low / np.maximum(1, freq)) ** 6) ** -0.5
    if slope:
        shape *= (np.maximum(freq, 40) / 1000) ** (-slope * 0.5)
    spectrum *= shape
    return normalise(fft.irfft(spectrum, n=length), 1)


def bed(out, seed, low, high, amplitude, slope=0.0, width=0.4):
    common = texture(seed, low, high, slope)
    scale = amplitude / math.sqrt((1 - width) ** 2 + width ** 2)
    for channel in range(2):
        independent = texture(seed + 17 + channel * 13, low, high, slope)
        out[:, channel] += scale * ((1 - width) * common + width * independent)


def add(out, mono, at, gain, pan=0.0):
    begin = round(at * SR)
    stop = min(len(out), begin + len(mono))
    if begin < 0 or begin >= stop:
        return
    sound = mono[:stop - begin] * gain
    angle = (np.clip(pan, -1, 1) + 1) * math.pi / 4
    out[begin:stop, 0] += sound * math.cos(angle)
    out[begin:stop, 1] += sound * math.sin(angle)


def filtered(a, low, high):
    sos = signal.butter(3, [low, high], btype='bandpass', fs=SR, output='sos')
    return signal.sosfilt(sos, a).astype(np.float32)


def read_voice(index):
    sample_rate, pcm = wavfile.read(SOURCE / f'voice-{index}.wav')
    voice = pcm.astype(np.float32) / (32768 if pcm.dtype == np.int16 else np.iinfo(pcm.dtype).max)
    if voice.ndim > 1:
        voice = voice.mean(axis=1)
    divisor = math.gcd(sample_rate, SR)
    return signal.resample_poly(voice, SR // divisor, sample_rate // divisor).astype(np.float32)


def hall(voice, seed, wet=0.20, decay=0.75):
    rng = np.random.default_rng(seed)
    n = int(SR * decay * 2.6)
    t = np.arange(n) / SR
    impulse = rng.standard_normal(n).astype(np.float32) * np.exp(-t / decay * 4)
    impulse = filtered(impulse, 250, 3400)
    impulse = normalise(impulse, 1 / math.sqrt(n))
    reflected = signal.fftconvolve(voice, impulse).astype(np.float32)
    output = reflected * wet
    output[:len(voice)] += voice
    for delay, amount in [(0.043, 0.12), (0.079, 0.09), (0.121, 0.06), (0.193, 0.035)]:
        offset = round(delay * SR)
        end = min(len(output), offset + len(voice))
        output[offset:end] += voice[:end - offset] * amount
    return output


def forest():
    out = np.zeros((LENGTH, 2), dtype=np.float32)
    # Warm pink/brown layers have much less top-end energy than the former wide
    # hiss. Independent stereo fields provide depth without rhythmic swells.
    bed(out, 3101, 85, 1650, 0.080, slope=1.25, width=0.44)
    bed(out, 3102, 330, 2300, 0.034, slope=1.0, width=0.58)
    bed(out, 3103, 55, 380, 0.023, slope=1.7, width=0.28)
    bed(out, 3104, 800, 2600, 0.006, slope=1.2, width=0.65)
    # Dense, soft, non-tonal leaf patter supplies diffuse rain detail. No isolated
    # pitched water drops, abrupt attacks, animals, thunder or periodic wind.
    rng = np.random.default_rng(3105)
    for at in rng.uniform(0, DURATION + OVERLAP, 9000):
        length = int(rng.uniform(0.055, 0.145) * SR)
        t = np.arange(length) / SR
        tap = rng.standard_normal(length).astype(np.float32)
        tap = normalise(filtered(tap, 380, rng.uniform(1450, 2150)), 1)
        envelope = (1 - np.exp(-t / 0.009)) * np.exp(-t / rng.uniform(0.025, 0.055))
        envelope *= np.minimum(1, (length / SR - t) / 0.012)
        add(out, tap * envelope, at, rng.uniform(0.006, 0.016), rng.uniform(-0.85, 0.85))
    # Sleep-oriented rolloff removes the remaining sizzle without changing the
    # texture's level over time. Filtering happens before the seamless wrap.
    lowpass = signal.butter(4, 2400, btype='lowpass', fs=SR, output='sos')
    return signal.sosfilt(lowpass, out, axis=0).astype(np.float32)


def chime():
    length = int(1.55 * SR)
    result = np.zeros(length, dtype=np.float32)
    for at, frequency in [(0, 659.255), (0.30, 523.251)]:
        offset = int(at * SR)
        t = np.arange(length - offset) / SR
        env = (1 - np.exp(-t / 0.018)) * np.exp(-t / 0.28)
        env *= np.minimum(1, (length / SR - at - t) / 0.025)
        result[offset:] += (np.sin(2 * np.pi * frequency * t) + 0.13 * np.sin(2 * np.pi * frequency * 2.003 * t)) * env
    return result


def airport():
    out = np.zeros((LENGTH, 2), dtype=np.float32)
    bed(out, 2001, 48, 1050, 0.071, slope=0.6, width=0.34)
    bed(out, 2002, 400, 2800, 0.019, slope=0.7, width=0.60)
    bed(out, 2003, 28, 160, 0.016, slope=0.3, width=0.20)
    rng = np.random.default_rng(2004)
    # Real speech fragments form a distant indistinct crowd, filtered well below the PA.
    conversation = read_voice(3)
    for at in np.arange(4, DURATION - 4, 4.7):
        count = int(rng.uniform(0.5, 1.7) * SR)
        offset = rng.integers(0, max(1, len(conversation) - count))
        fragment = filtered(conversation[offset:offset + count], 160, 1000)
        envelope = np.sin(np.linspace(0, math.pi, len(fragment))) ** 1.4
        fragment = normalise(fragment * envelope, 0.028)
        fragment = 0.11 * np.tanh(fragment / 0.11)
        add(out, hall(fragment, int(at * 100), wet=0.55, decay=0.60), at, 1, rng.uniform(-0.9, 0.9))
    # A few wheeled suitcases pass softly from one side of the hall to the other.
    for i, at in enumerate([7.2, 18.6, 29.5, 58.1, 72.4, 82.6, 111.2]):
        duration = rng.uniform(2.2, 4.6)
        count = int(duration * SR)
        roll = texture(2100 + i, 100, 1800, slope=0.8, length=count)
        t = np.arange(count) / SR
        env = np.sin(np.linspace(0, math.pi, count)) ** 2
        roll *= env * (0.77 + 0.15 * np.sin(2 * np.pi * (14 + i) * t) + 0.08 * np.sin(2 * np.pi * 7.7 * t))
        begin = int(at * SR)
        angles = np.linspace(0.18, 1.36, count)
        if i % 2:
            angles = angles[::-1]
        out[begin:begin + count, 0] += roll * np.cos(angles) * 0.043
        out[begin:begin + count, 1] += roll * np.sin(angles) * 0.043
    announcement_info = []
    foreground = np.zeros((DURATION * SR, 2), dtype=np.float32)
    for i, cue_at in enumerate([PA_CUE_START, PA_CUE_START + PA_INTERVAL], start=1):
        at = cue_at + PA_SPEECH_DELAY
        speech = filtered(read_voice(i), 190, 4400)
        # SAPI recordings have isolated consonant transients well above their
        # average level. Gentle saturation controls those before hall reflections,
        # so one syllable cannot force the entire 120-second ambience quieter.
        speech = normalise(speech, 0.20)
        speech = 0.48 * np.tanh(speech / 0.48)
        broadcast = hall(speech, 2300 + i, wet=0.30, decay=0.78)
        add(foreground, broadcast, at, 1.0, -0.08)
        add(foreground, hall(chime(), 2400 + i, wet=0.20, decay=0.75), cue_at, 0.095, -0.08)
        announcement_info.append({'cueAtSeconds': cue_at, 'atSeconds': at,
                                  'voiceSeconds': len(speech) / SR, 'text': ANNOUNCEMENTS[i - 1]})
    return out, foreground, announcement_info


def loop_and_balance(audio, target=0.130, foreground=None):
    frames = DURATION * SR
    overlap = OVERLAP * SR
    # The end feeds continuously into the tail that starts the loop. Equal-power
    # mixing then returns to the initial field; there is no fade-to-silence seam.
    result = audio[:frames].copy()
    angle = np.linspace(0, math.pi / 2, overlap, dtype=np.float32)
    result[:overlap] = audio[frames:frames + overlap] * np.cos(angle[:, None]) + result[:overlap] * np.sin(angle[:, None])
    if foreground is not None:
        # Opening cues are mixed after wrapping the background so they retain
        # their attack; a crossfade must not fade away the first announcement.
        result += foreground[:frames]
        result = 0.40 * np.tanh(result / 0.40)
    result = normalise(result, target)
    peak = float(np.max(np.abs(result)))
    if peak > 0.82:
        result *= 0.82 / peak
    return result


def metrics(audio, path):
    adjacent = np.abs(np.diff(audio, axis=0))
    boundary = np.abs(audio[0] - audio[-1])
    one_second = np.sqrt(np.mean(audio.reshape(DURATION, SR, 2).astype(np.float64) ** 2, axis=(1, 2)))
    one_second_db = 20 * np.log10(np.maximum(1e-9, one_second))
    frequency, power = signal.welch(audio, fs=SR, nperseg=16384, axis=0)
    power = power.mean(axis=1)
    band_energy = {}
    for label, low, high in [('under125Hz', 0, 125), ('125to500Hz', 125, 500),
                              ('500to2000Hz', 500, 2000), ('2000to4000Hz', 2000, 4000),
                              ('above4000Hz', 4000, SR / 2 + 1)]:
        band_energy[label] = float(100 * power[(frequency >= low) & (frequency < high)].sum() / power.sum())
    return {
        'file': str(path.relative_to(WORKSPACE)), 'bytes': path.stat().st_size,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'durationSeconds': len(audio) / SR, 'sampleRate': SR, 'channels': audio.shape[1],
        'rmsDbfs': 20 * math.log10(max(1e-9, rms(audio))),
        'peakDbfs': 20 * math.log10(max(1e-9, float(np.max(np.abs(audio))))),
        'clippedSamples': int(np.count_nonzero(np.abs(audio) >= 0.999)),
        'loopBoundaryDelta': boundary.tolist(),
        'ordinaryAdjacentDeltaP99': np.quantile(adjacent, 0.99, axis=0).tolist(),
        'oneSecondRmsDbfs': {'min': float(one_second_db.min()), 'max': float(one_second_db.max()),
                            'p05': float(np.quantile(one_second_db, 0.05)),
                            'p95': float(np.quantile(one_second_db, 0.95)),
                            'p95MinusP05': float(np.quantile(one_second_db, 0.95) - np.quantile(one_second_db, 0.05))},
        'spectralCentroidHz': float((frequency * power).sum() / power.sum()),
        'frequencyBandPowerPercent': band_energy
    }


def write_ogg(path, audio):
    # libsndfile's Vorbis writer uses stack scratch space proportional to each
    # write size on Windows. Small blocks avoid overflowing the native stack.
    with sf.SoundFile(path, mode='w', samplerate=SR, channels=2, format='OGG',
                      subtype='VORBIS', compression_level=0.45) as output:
        for start in range(0, len(audio), SR * 2):
            output.write(audio[start:start + SR * 2])


def correlation(a, b):
    return float(np.dot(a.astype(np.float64), b.astype(np.float64)) /
                 max(1e-12, np.linalg.norm(a.astype(np.float64)) * np.linalg.norm(b.astype(np.float64))))


def verify_pa_recording(audio, announcements):
    """Verify the actual encoded/decoded file contains each scheduled cue and voice.

    Correlation uses the independently regenerated pre-mix recordings, not a
    metadata timestamp alone. The nonlinear hall compressor and background
    naturally lower the score; a wrong time or missing voice approaches zero.
    """
    mono = audio.mean(axis=1)
    checks = []
    for index, entry in enumerate(announcements, start=1):
        speech = normalise(filtered(read_voice(index), 190, 4400), 0.20)
        speech = 0.48 * np.tanh(speech / 0.48)
        voice_reference = hall(speech, 2300 + index, wet=0.30, decay=0.78)
        begin = round(entry['atSeconds'] * SR)
        voice_score = correlation(mono[begin:begin + len(voice_reference)], voice_reference)
        # The narrow chime band rejects most ventilation noise and speech, so the
        # very first, deliberately quiet cue can still be checked numerically.
        cue_reference = filtered(chime(), 460, 730)
        cue_begin = round(entry['cueAtSeconds'] * SR)
        cue_recording = filtered(mono[cue_begin:cue_begin + len(cue_reference)], 460, 730)
        cue_score = correlation(cue_recording, cue_reference)
        assert voice_score > 0.40, f'Announcement {index} missing/misaligned: {voice_score}'
        assert cue_score > 0.25, f'Opening chime {index} missing/misaligned: {cue_score}'
        checks.append({'cueAtSeconds': entry['cueAtSeconds'], 'voiceAtSeconds': entry['atSeconds'],
                       'encodedCueCorrelation': cue_score, 'encodedVoiceCorrelation': voice_score})
    assert 0 <= checks[0]['cueAtSeconds'] <= 1
    assert checks[0]['voiceAtSeconds'] <= 2
    assert math.isclose(checks[1]['cueAtSeconds'] - checks[0]['cueAtSeconds'], PA_INTERVAL)
    assert math.isclose(checks[1]['voiceAtSeconds'] - checks[0]['voiceAtSeconds'], PA_INTERVAL)
    assert math.isclose(DURATION + checks[0]['cueAtSeconds'] - checks[1]['cueAtSeconds'], PA_INTERVAL)
    return checks


def verify_metrics(reports):
    for track in reports:
        assert track['durationSeconds'] == DURATION and track['channels'] == 2
        assert track['clippedSamples'] == 0
        assert track['peakDbfs'] < -1
        assert all(boundary < ordinary * 2 for boundary, ordinary in
                   zip(track['loopBoundaryDelta'], track['ordinaryAdjacentDeltaP99']))
    rain = reports[0]
    assert rain['frequencyBandPowerPercent']['above4000Hz'] < 0.01
    assert rain['oneSecondRmsDbfs']['p95MinusP05'] < 1.0
    assert abs(reports[0]['rmsDbfs'] - reports[1]['rmsDbfs']) < 0.5


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reuse-voices', action='store_true')
    args = parser.parse_args()
    for folder in [SOURCE, ASSETS, QA]:
        folder.mkdir(parents=True, exist_ok=True)
    if not args.reuse_voices:
        create_voices()
    print('Building forest rain...', flush=True)
    rain = loop_and_balance(forest())
    forest_path = ASSETS / 'forest-rain.ogg'
    write_ogg(forest_path, rain)
    shutil.copyfile(forest_path, QA / '森林雨声.ogg')
    reports = [metrics(sf.read(forest_path, dtype='float32')[0], forest_path)]
    # Include the encoded boundary twice in a short preview so loop continuity
    # can be assessed directly without waiting two minutes.
    write_ogg(QA / '森林雨声-循环接缝预览.ogg', np.concatenate([rain[-8 * SR:], rain[:8 * SR]]))
    del rain
    print('Building airport hall and Chinese PA...', flush=True)
    hall_audio, foreground, pa = airport()
    hall_audio = loop_and_balance(hall_audio, foreground=foreground)
    airport_path = ASSETS / 'airport.ogg'
    write_ogg(airport_path, hall_audio)
    shutil.copyfile(airport_path, QA / '机场候机.ogg')
    write_ogg(QA / '机场候机-开场播报预览.ogg', hall_audio[:26 * SR])
    write_ogg(QA / '机场候机-第二次播报预览.ogg', hall_audio[58 * SR:86 * SR])
    decoded_airport = sf.read(airport_path, dtype='float32')[0]
    reports.append(metrics(decoded_airport, airport_path))
    pa_checks = verify_pa_recording(decoded_airport, pa)
    verify_metrics(reports)
    report = {'generator': 'original deterministic synthesis + installed offline SAPI Huihui',
              'voiceRuntimeDependency': False, 'speechVoice': 'Microsoft Huihui Desktop zh-CN',
              'announcementIntervalSeconds': PA_INTERVAL,
              'announcements': pa, 'encodedAnnouncementChecks': pa_checks,
              'qualityChecksPassed': True, 'tracks': reports}
    # A content-hashed manifest lets the no-audio-device regression runner check
    # that the packaged files and their verified opening/recurrence schedule match.
    manifest = {'version': 2, 'durationSeconds': DURATION, 'sampleRate': SR, 'channels': 2,
                'announcementIntervalSeconds': PA_INTERVAL, 'announcements': pa,
                'encodedAnnouncementChecks': pa_checks,
                'tracks': [{**entry, 'id': entry['file'].split('\\')[-1].split('/')[-1].removesuffix('.ogg')}
                           for entry in reports]}
    (ASSETS / 'ambient-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    (QA / 'ambient-audio-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
