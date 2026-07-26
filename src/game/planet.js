import * as THREE from 'three';

// A "walker" tracks a point on a sphere's surface purely by direction (the
// surface normal at the player's feet) plus a tangent facing vector. Moving
// forward rotates both vectors together around the axis perpendicular to
// them, which slides the point along a great circle — walk far enough in one
// direction and the normal comes back around to where it started, giving the
// "walk around the planet" loop for free without any position wrapping.
export function createPlanetWalker(startNormal = new THREE.Vector3(0, 1, 0), startForward = new THREE.Vector3(0, 0, -1)) {
  const normal = startNormal.clone().normalize();
  const forward = startForward.clone();

  const _right = new THREE.Vector3();
  const _quat = new THREE.Quaternion();

  function orthogonalize() {
    forward.addScaledVector(normal, -forward.dot(normal)).normalize();
  }
  orthogonalize();

  return {
    normal,
    forward,
    moveForward(distance, radius) {
      if (distance === 0) return;
      _right.crossVectors(normal, forward).normalize();
      _quat.setFromAxisAngle(_right, distance / radius);
      normal.applyQuaternion(_quat);
      forward.applyQuaternion(_quat);
      orthogonalize();
    },
    turn(angle) {
      if (angle === 0) return;
      _quat.setFromAxisAngle(normal, angle);
      forward.applyQuaternion(_quat);
      orthogonalize();
    },
    getPosition(radius, target = new THREE.Vector3()) {
      return target.copy(normal).multiplyScalar(radius);
    },
    getOrientationQuaternion(target = new THREE.Quaternion()) {
      return basisQuaternion(normal, forward, target);
    },
  };
}

// Builds the quaternion for the right-handed basis {right, up, -forward}
// (three.js objects face their local -Z by default).
function basisQuaternion(up, forwardHint, target = new THREE.Quaternion()) {
  const right = new THREE.Vector3().crossVectors(forwardHint, up).normalize();
  const forward = new THREE.Vector3().crossVectors(up, right).normalize();
  const m = new THREE.Matrix4().makeBasis(right, up, forward.negate());
  return target.setFromRotationMatrix(m);
}

// Orients an object so its local +Y points along `normal` (i.e. stands
// upright on a sphere at that point), with an optional random spin around
// that up axis so scattered props don't all face the same way.
export function orientToNormal(object3D, normal, spin = 0) {
  const hint = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  object3D.quaternion.copy(basisQuaternion(normal, hint));
  if (spin) object3D.rotateY(spin);
}

// Evenly distributes `count` points across a unit sphere.
export function fibonacciSphere(count) {
  const points = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
  }
  return points;
}
