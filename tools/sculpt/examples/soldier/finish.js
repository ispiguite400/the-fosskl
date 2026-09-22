// ---- head group looks down a little and turns slightly; then everything is joined ----
{
  const sc = M.app.scene;
  for (const o of sc.objects) if (['Head', 'Helmet', 'Glasses', 'Wrap'].includes(o.name)) M.clay.pivotRotate(o, [0, 1.5, 0], [7, -5, 0]);
}
M.joinAll();
