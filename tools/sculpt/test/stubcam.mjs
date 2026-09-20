/* A minimal perspective camera for driving the stroke engine in tests. */
export function makeCamera(S, opts = {}) {
  const fov = opts.fov || (45 * Math.PI / 180);
  const width = opts.width || 800, height = opts.height || 600;
  const eye = S.V3.create(0, 0, opts.distance || 3);
  const target = S.V3.create(0, 0, 0);
  return {
    eye, target, width, height, fov,
    rayFromScreen(sx, sy, outO, outD) {
      const ndcX = (sx / width) * 2 - 1;
      const ndcY = 1 - (sy / height) * 2;
      const tanH = Math.tan(fov / 2);
      S.V3.copy(outO, eye);
      S.V3.set(outD, ndcX * tanH * (width / height), ndcY * tanH, -1);
      S.V3.normalize(outD, outD);
    },
    worldPerPixel(point) {
      const d = S.V3.dist(point, eye);
      return (2 * Math.tan(fov / 2) * d) / height;
    },
    right() { return S.V3.AXIS_X; },
    up() { return S.V3.AXIS_Y; }
  };
}

export function defaultSettings(over = {}) {
  return Object.assign({
    brush: 'clay', radius: 60, strength: 0.6, falloff: 'smooth', spacing: 0.2,
    strokeSmoothing: 0, autoSmooth: 0.28, clayOffset: 0.18,
    dyntopo: false, detailMode: 'relative', detailPercent: 25, detailSize: 0.01,
    maxTriangles: 2000000, frontFacing: true,
    symmetryX: false, symmetryY: false, symmetryZ: false,
    pressureRadius: false, pressureStrength: false,
    paintColor: new Float32Array([0.9, 0.1, 0.1])
  }, over);
}
