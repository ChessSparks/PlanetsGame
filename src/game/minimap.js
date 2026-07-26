const SIZE = 160;
const RANGE = 26; // world units from center to the outer edge

// A little rocket-ship glyph so the repair objective reads as a landmark
// rather than just another dot on the radar.
function drawShipIcon(ctx, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.65, size * 0.8);
  ctx.lineTo(0, size * 0.35);
  ctx.lineTo(-size * 0.65, size * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// A GTA-style radar: player is always the fixed center arrow pointing "up"
// (the direction they're facing); every blip is drawn at its position
// relative to the player's own forward/right tangent vectors, so it rotates
// naturally as the player turns without needing any global "north" on a sphere.
export function createMinimap() {
  const wrap = document.createElement('div');
  wrap.id = 'minimap';
  wrap.style.cssText = `
    position: fixed; left: 16px; bottom: 16px; width: ${SIZE}px; height: ${SIZE}px;
    border-radius: 50%; overflow: hidden; border: 2px solid rgba(120,200,255,0.5);
    background: rgba(6,14,28,0.75); box-shadow: 0 0 18px rgba(0,0,0,0.5); z-index: 15;
  `;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  wrap.appendChild(canvas);
  document.body.appendChild(wrap);
  const ctx = canvas.getContext('2d');

  function draw(blips) {
    ctx.clearRect(0, 0, SIZE, SIZE);
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const scale = (SIZE / 2 - 6) / RANGE;

    ctx.strokeStyle = 'rgba(120,200,255,0.18)';
    ctx.lineWidth = 1;
    for (const f of [0.34, 0.67, 1]) {
      ctx.beginPath();
      ctx.arc(cx, cy, (SIZE / 2 - 4) * f, 0, Math.PI * 2);
      ctx.stroke();
    }

    const edgeRadius = SIZE / 2 - 10;
    for (const b of blips) {
      const dist = Math.hypot(b.dx, b.dy);
      let px;
      let py;
      let offEdge = false;
      if (dist > RANGE && dist > 0) {
        // Beyond radar range — clamp to the edge in the same direction
        // instead of hiding it, like an off-screen objective indicator.
        px = cx + (b.dx / dist) * edgeRadius;
        py = cy - (b.dy / dist) * edgeRadius;
        offEdge = true;
      } else {
        px = cx + b.dx * scale;
        py = cy - b.dy * scale;
      }
      const size = (b.size || 4) * (offEdge ? 0.8 : 1);
      if (b.shape === 'ship') {
        drawShipIcon(ctx, px, py, (b.size || 7) * (offEdge ? 0.8 : 1), b.color);
      } else {
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx - 6, cy + 6);
    ctx.lineTo(cx + 6, cy + 6);
    ctx.closePath();
    ctx.fill();
  }

  function destroy() {
    wrap.remove();
  }

  return { draw, destroy };
}
