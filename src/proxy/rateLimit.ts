// 固定ウィンドウのレート制限（キーごと）。Worker の isolate ごとのメモリに持つ簡易版で、
// isolate をまたいだ厳密な制限ではない（身内テスト用。DEPLOY.md に本番向けの置き換え先を記載）。

export interface RateLimiter {
  /** 許可なら null、超過なら再試行までのミリ秒 */
  readonly hit: (key: string, now: number, limit: number, windowMs: number) => number | null;
}

export const makeRateLimiter = (): RateLimiter => {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit: (key, now, limit, windowMs) => {
      const current = windows.get(key);
      if (current === undefined || now - current.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return null;
      }
      if (current.count >= limit) return current.start + windowMs - now;
      current.count++;
      return null;
    },
  };
};
