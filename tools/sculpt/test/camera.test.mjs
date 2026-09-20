import { load, check, eq, report, cameraTests } from './harness.mjs';
const S = load();
cameraTests(S, { check, eq });

/* the stroke engine must work when driven by the real camera */
{
  const scene = new S.Scene();
  const obj = new S.SceneObject('T', S.Prim.makeMesh('sphere', 4));
  scene.add(obj);
  const cam = new S.Camera();
  cam.setViewport(1024, 768);
  cam.frameBounds(obj.mesh.boundsMin(), obj.mesh.boundsMax(), true);
  const settings = {
    brush: 'clay', radius: 70, strength: 0.7, falloff: 'smooth', spacing: 0.15,
    dyntopo: true, detailMode: 'relative', detailPercent: 22, maxTriangles: 500000,
    frontFacing: true, symmetryX: true, autoSmooth: 0.2,
    paintColor: new Float32Array([1, 0, 0])
  };
  const history = new S.History();
  const engine = new S.StrokeEngine({ scene, history, settings, camera: cam });
  const hit = engine.pick(512, 384);
  check('real camera picks the framed sphere', !!hit);
  const before = obj.mesh.positions.copy();
  engine.begin({ x: 512, y: 384, pressure: 1 });
  for (let i = 1; i <= 15; i++) engine.move({ x: 512 + i * 8, y: 384 + i * 3, pressure: 1 });
  engine.end();
  let moved = 0;
  for (let i = 0; i < before.length; i++) moved = Math.max(moved, Math.abs(before[i] - obj.mesh.positions.array[i]));
  check('stroke driven by the real camera changes the mesh', moved > 1e-4, `${moved}`);
  eq('mesh still closed', obj.mesh.countBorderEdges(), 0);

  // orbit, then sculpt from the new angle
  cam.orbit(300, 120);
  const hit2 = engine.pick(512, 384);
  check('after orbiting, the centre still hits the model', !!hit2);
  check('the new hit faces the camera', hit2 && S.V3.dot(hit2.normal, cam.forward()) < 0);
}

report('camera');
