import { randomStream } from "../map/geometry2d";
import type { Season, Sky } from "../transitions/weather";
import { AMBIENCE, DEFAULT_VOLUMES, effectiveGain, SOUND_RECIPES, type NoiseLayer, type SoundId, type SoundLayer, type Volumes } from "./soundRecipes";

// 小さな音の係（SPEC_v3.3 §8.1・CLAUDE.md §2「小さな AudioService（Web Audio API）」）。
// 主音量 → 効果音 / 環境音 の2系統。音はすべて soundRecipes の合成（素材ファイルなし）。
// ブラウザは操作の前に音を出させないので、最初のクリック・キーで unlock する。Web Audio の無い環境（テスト）では何もしない。

type AudioContextLike = AudioContext;

const NOISE_SECONDS = 2;
const PLAYED_LOG = 64;
/** 雑音の素（seed 付き：Math.random は使わない） */
const NOISE_SEED = 0x5eed;

export class AudioService {
  private context: AudioContextLike | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambient: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volumes: Volumes = DEFAULT_VOLUMES;
  private lastPlayed = new Map<SoundId, number>();
  private ambience: { sources: AudioScheduledSourceNode[]; key: string } | null = null;
  private wantedAmbience: { season: Season; sky: Sky } | null = null;
  /** 直近に鳴らした音（開発・テスト用。最大 PLAYED_LOG 件） */
  readonly played: SoundId[] = [];

  constructor(private readonly factory: () => AudioContextLike | null = defaultFactory) {}

  /** 最初の操作で呼ぶ（音を出せるようにする） */
  unlock(): void {
    if (this.context === null) {
      const context = this.factory();
      if (context === null) return;
      this.context = context;
      this.master = context.createGain();
      this.sfx = context.createGain();
      this.ambient = context.createGain();
      this.sfx.connect(this.master);
      this.ambient.connect(this.master);
      this.master.connect(context.destination);
      this.noise = makeNoise(context);
      this.applyVolumes();
      if (this.wantedAmbience) this.setAmbience(this.wantedAmbience.season, this.wantedAmbience.sky);
    }
    if (this.context.state === "suspended") void this.context.resume();
  }

  setVolumes(volumes: Volumes): void {
    this.volumes = volumes;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.context || !this.master || !this.sfx || !this.ambient) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(1, now, 0.05);
    this.sfx.gain.setTargetAtTime(effectiveGain(this.volumes, "sfx"), now, 0.05);
    this.ambient.gain.setTargetAtTime(effectiveGain(this.volumes, "ambient"), now, 0.3);
  }

  /** 効果音を1回鳴らす（間引きのある音は、間が短ければ鳴らさない） */
  play(id: SoundId, when = 0): void {
    this.played.push(id);
    if (this.played.length > PLAYED_LOG) this.played.splice(0, this.played.length - PLAYED_LOG);
    const context = this.context;
    if (!context || !this.sfx || !this.noise || effectiveGain(this.volumes, "sfx") === 0) return;
    const recipe = SOUND_RECIPES[id];
    const now = context.currentTime + when;
    const last = this.lastPlayed.get(id) ?? -Infinity;
    if (recipe.minInterval !== undefined && now - last < recipe.minInterval) return;
    this.lastPlayed.set(id, now);
    for (const layer of recipe.layers) this.layer(layer, now, this.sfx);
  }

  /** ある長さのあいだ、間を置いて繰り返し鳴らす（地図の描き込みのペン先） */
  playFor(id: SoundId, seconds: number, every = 0.22): void {
    for (let t = 0; t < seconds; t += every) this.play(id, t);
  }

  /** 環境音：ランプは常に、雨の年は雨、秋冬は風 */
  setAmbience(season: Season, sky: Sky): void {
    this.wantedAmbience = { season, sky };
    const context = this.context;
    if (!context || !this.ambient || !this.noise) return;
    const key = `${season}:${sky}`;
    if (this.ambience?.key === key) return;
    for (const source of this.ambience?.sources ?? []) source.stop(context.currentTime + 1.5);
    const layers: NoiseLayer[] = [AMBIENCE.lamp];
    if (sky === "rain") layers.push(AMBIENCE.rain);
    if (season === "autumn" || season === "winter") layers.push(AMBIENCE.wind);
    this.ambience = { key, sources: layers.map((layer) => this.loop(layer, this.ambient as GainNode)) };
  }

  dispose(): void {
    for (const source of this.ambience?.sources ?? []) source.stop();
    this.ambience = null;
    void this.context?.close();
    this.context = null;
  }

  private layer(layer: SoundLayer, start: number, bus: GainNode): void {
    const context = this.context as AudioContextLike;
    const at = start + (layer.delay ?? 0);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, layer.gain), at + layer.attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + layer.attack + layer.decay);
    envelope.connect(bus);
    const end = at + layer.attack + layer.decay + 0.05;
    if (layer.kind === "noise") {
      const source = context.createBufferSource();
      source.buffer = this.noise;
      const filter = context.createBiquadFilter();
      filter.type = layer.filter;
      filter.frequency.value = layer.frequency;
      filter.Q.value = layer.q;
      source.connect(filter).connect(envelope);
      // 雑音の素の、毎回ちがう場所から鳴らす（同じ音の繰り返しに聞こえないように）
      source.start(at, (at * 7.31) % (NOISE_SECONDS - 0.5));
      source.stop(end);
    } else {
      const osc = context.createOscillator();
      osc.type = layer.wave;
      osc.frequency.setValueAtTime(layer.frequency, at);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, layer.endFrequency), at + layer.attack + layer.decay);
      osc.connect(envelope);
      osc.start(at);
      osc.stop(end);
    }
  }

  private loop(layer: NoiseLayer, bus: GainNode): AudioScheduledSourceNode {
    const context = this.context as AudioContextLike;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = layer.filter;
    filter.frequency.value = layer.frequency;
    filter.Q.value = layer.q;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(layer.gain, context.currentTime + layer.attack);
    source.connect(filter).connect(gain).connect(bus);
    source.start();
    return source;
  }
}

const defaultFactory = (): AudioContextLike | null => {
  const Ctor = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
};

const makeNoise = (context: AudioContextLike): AudioBuffer => {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * NOISE_SECONDS), context.sampleRate);
  const data = buffer.getChannelData(0);
  const random = randomStream(NOISE_SEED, 1);
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
  return buffer;
};
