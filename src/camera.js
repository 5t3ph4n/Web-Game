import * as THREE from 'three';
import { R, sample } from './planet.js';
import { tangent } from './player.js';

/** Third-person orbit camera that lives in the player's local (curved) frame. */
export class FollowCam {
  constructor(camera) {
    this.camera = camera;
    this.forward = new THREE.Vector3(0, 0, 1); // tangent, where the camera looks
    this.pitch = 0.42;
    this.dist = 11;
    this.targetDist = 11;
    this.up = new THREE.Vector3(0, 1, 0);
    this.target = new THREE.Vector3();
    this.idle = 0;
    this.shake = 0;
    this.photo = false;
  }
  snap(player) {
    this.up.copy(player.up);
    this.forward.copy(player.facing);
    this.target.copy(player.pos);
  }
  update(dt, player, input, focus) {
    const up = this.up.lerp(player.up, Math.min(1, dt * 6)).normalize();
    tangent(this.forward, up);
    // user orbit
    if (input.look.dx || input.look.dy) {
      this.forward.applyAxisAngle(up, -input.look.dx * 0.0055);
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.look.dy * 0.004, -0.15, 1.35);
      this.idle = 0;
    } else this.idle += dt;
    if (input.zoom) this.targetDist = THREE.MathUtils.clamp(this.targetDist + input.zoom * 1.4, 4.5, 30);
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 6);

    // gently swing behind the player when moving and not orbiting
    if (this.idle > 1.2 && player.speed > 2 && !this.photo) {
      const behind = player.facing.clone();
      const ang = Math.atan2(this.forward.clone().cross(behind).dot(up), this.forward.dot(behind));
      // don't fight when walking toward the camera
      if (Math.abs(ang) < 2.4) this.forward.applyAxisAngle(up, ang * Math.min(1, dt * 0.9));
    }
    tangent(this.forward, up);

    const lookH = player.mode === 'swim' ? 0.6 : 1.4;
    const goal = player.pos.clone().addScaledVector(player.up, lookH);
    if (focus) goal.lerp(focus, 0.35);
    this.target.lerp(goal, Math.min(1, dt * 10));

    const back = this.forward.clone().multiplyScalar(-Math.cos(this.pitch)).addScaledVector(up, Math.sin(this.pitch));
    const camPos = this.target.clone().addScaledVector(back, this.dist);
    // keep above terrain / water
    const cd = camPos.clone().normalize();
    const minR = R + Math.max(sample(cd), 0) + 0.8;
    if (camPos.length() < minR) camPos.setLength(minR);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2);
      camPos.x += (Math.random() - 0.5) * this.shake * 0.3;
      camPos.y += (Math.random() - 0.5) * this.shake * 0.3;
    }
    this.camera.position.copy(camPos);
    this.camera.up.copy(up);
    this.camera.lookAt(this.target);
  }
}
