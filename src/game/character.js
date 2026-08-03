import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

// The rig's front faces local +Z, but the sphere-walking orientation code
// (planet.js basisQuaternion) builds its basis assuming the Three.js default
// front (local -Z) — so this rig needs a 180° correction on top of that to
// actually face the movement direction instead of facing the camera.
const MODEL_FORWARD_OFFSET = Math.PI;

const TARGET_HEIGHT = 1.8;

export async function loadAstronaut(url = '/assets/Astronaut.glb') {
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  model.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  // Source export scale/origin varies by pipeline; normalize to a known
  // height with feet at y=0. The model is nested in a wrapper group so
  // gameplay code can freely set the wrapper's position/rotation each frame
  // without fighting this one-time centering offset applied to the child.
  const box = new THREE.Box3().setFromObject(model);
  const rawHeight = box.max.y - box.min.y;
  const scale = rawHeight > 0 ? TARGET_HEIGHT / rawHeight : 1;
  model.scale.setScalar(scale);

  const rescaledBox = new THREE.Box3().setFromObject(model);
  model.position.x -= (rescaledBox.max.x + rescaledBox.min.x) / 2;
  model.position.z -= (rescaledBox.max.z + rescaledBox.min.z) / 2;
  model.position.y -= rescaledBox.min.y;

  const wrapper = new THREE.Group();
  wrapper.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of gltf.animations) {
    const name = clip.name.split('|')[1] || clip.name;
    actions[name] = mixer.clipAction(clip);
  }

  let current = null;

  function fadeTo(name, { duration = 0.25, loop = true, onFinished } = {}) {
    const next = actions[name];
    if (!next || next === current) return;

    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.enabled = true;
    next.play();
    if (current) {
      next.crossFadeFrom(current, duration, false);
    } else {
      next.fadeIn(duration);
    }
    current = next;

    if (onFinished) {
      const handler = (e) => {
        if (e.action === next) {
          mixer.removeEventListener('finished', handler);
          onFinished();
        }
      };
      mixer.addEventListener('finished', handler);
    }
  }

  // A one-shot animation (Interact, Roll, ...) that fades back to Idle on
  // its own once it finishes — the shared shape every "play this gesture,
  // then go back to standing around" call site across every scene needs,
  // pulled out here instead of each scene re-writing the same
  // fadeTo(name, { loop: false, onFinished: () => fadeTo('Idle', ...) })
  // block by hand.
  function playFlourish(name, { duration = 0.15, returnDuration = 0.2 } = {}) {
    fadeTo(name, {
      duration,
      loop: false,
      onFinished: () => fadeTo('Idle', { duration: returnDuration }),
    });
  }

  return {
    object3D: wrapper,
    mixer,
    actions,
    fadeTo,
    playFlourish,
    modelForwardOffset: MODEL_FORWARD_OFFSET,
    update(dt) {
      mixer.update(dt);
    },
  };
}
