/**
 * Render-delayed pose buffer for the viewer side.
 *
 * Poses arrive over the internet at an uneven rate, so applying them the moment
 * they land makes the panel stutter. This holds a small history and plays it
 * back {@link RENDER_DELAY_MS} behind real time, interpolating between the two
 * samples that bracket the render clock.
 *
 * It mirrors the semantics of the Unity package's `InterpolationBuffer`
 * (capacity, render delay, clamped extrapolation, hold outside the range) with
 * one deliberate difference: instead of `Quaternion.Slerp` it interpolates each
 * axis along the shortest arc. The wire protocol is already Euler and Unity
 * rebuilds the pose with `Quaternion.Euler(pitch, yaw, roll)`, so this avoids
 * pulling quaternion maths into the renderer while still taking the short way
 * round the ±180° seam.
 */

export const RENDER_DELAY_MS = 100;
const CAPACITY = 8;
const EXTRAPOLATION_LIMIT_MS = 50;

export interface Pose {
  yaw: number;
  pitch: number;
  roll: number;
}

interface Sample extends Pose {
  arrivalMs: number;
}

export class PoseInterpolator {
  private readonly ring: Sample[] = new Array<Sample>(CAPACITY);
  private count = 0;
  private start = 0;

  get isReady(): boolean {
    return this.count > 0;
  }

  push(pose: Pose, arrivalMs: number): void {
    const writeIdx = (this.start + this.count) % CAPACITY;
    this.ring[writeIdx] = { ...pose, arrivalMs };
    if (this.count < CAPACITY) {
      this.count++;
    } else {
      this.start = (this.start + 1) % CAPACITY;
    }
  }

  clear(): void {
    this.count = 0;
    this.start = 0;
  }

  /** Returns the pose to display at `renderTimeMs`, or null with no samples. */
  evaluate(renderTimeMs: number): Pose | null {
    if (this.count === 0) return null;

    const newest = this.ring[(this.start + this.count - 1) % CAPACITY];
    if (this.count === 1) return normalize(newest);

    // Ahead of the newest sample: extrapolate briefly, then freeze. Without the
    // limit a stalled presenter would send the panel spinning off.
    if (renderTimeMs >= newest.arrivalMs) {
      const overshoot = renderTimeMs - newest.arrivalMs;
      if (overshoot > EXTRAPOLATION_LIMIT_MS) return normalize(newest);

      const prev = this.ring[(this.start + this.count - 2) % CAPACITY];
      const span = newest.arrivalMs - prev.arrivalMs;
      if (span < 0.1) return normalize(newest);
      return lerpPose(prev, newest, 1 + overshoot / span);
    }

    const oldest = this.ring[this.start];
    if (renderTimeMs <= oldest.arrivalMs) return normalize(oldest);

    for (let i = this.count - 1; i >= 1; i--) {
      const a = this.ring[(this.start + i - 1) % CAPACITY];
      const b = this.ring[(this.start + i) % CAPACITY];
      if (a.arrivalMs <= renderTimeMs && b.arrivalMs >= renderTimeMs) {
        const span = b.arrivalMs - a.arrivalMs;
        if (span < 0.1) return normalize(b);
        return lerpPose(a, b, (renderTimeMs - a.arrivalMs) / span);
      }
    }

    return normalize(newest);
  }
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return {
    yaw: lerpAngle(a.yaw, b.yaw, t),
    pitch: lerpAngle(a.pitch, b.pitch, t),
    roll: lerpAngle(a.roll, b.roll, t),
  };
}

/** Interpolates along the shortest arc, so 179° → -179° moves 2°, not 358°. */
function lerpAngle(a: number, b: number, t: number): number {
  return wrap180(a + wrap180(b - a) * t);
}

function normalize(pose: Pose): Pose {
  return { yaw: wrap180(pose.yaw), pitch: wrap180(pose.pitch), roll: wrap180(pose.roll) };
}

function wrap180(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}
