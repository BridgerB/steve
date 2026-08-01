/**
 * Angle and velocity conversions between Notchian protocol values and radians.
 */

import { scalarEuclideanMod, type Vec3, vec3 } from "../vec3/index.ts";

const PI = Math.PI;
const PI_2 = Math.PI * 2;
const TO_RAD = PI / 180;
const TO_DEG = 1 / TO_RAD;
const FROM_NOTCH_BYTE = 360 / 256;
const FROM_NOTCH_VEL = 1 / 8000;

export const toRadians = (degrees: number): number => TO_RAD * degrees;

export const toDegrees = (radians: number): number => TO_DEG * radians;

/** Convert Notchian yaw (degrees, clockwise from south) to radians. */
export const fromNotchianYaw = (yaw: number): number =>
	scalarEuclideanMod(PI - toRadians(yaw), PI_2);

/** Convert Notchian pitch (degrees) to radians. */
export const fromNotchianPitch = (pitch: number): number =>
	scalarEuclideanMod(toRadians(-pitch) + PI, PI_2) - PI;

/** Convert radians yaw to Notchian degrees. */
export const toNotchianYaw = (yaw: number): number => toDegrees(PI - yaw);

/** Convert radians pitch to Notchian degrees. */
export const toNotchianPitch = (pitch: number): number => toDegrees(-pitch);

/** Convert Notchian yaw byte (0-255) to radians. */
export const fromNotchianYawByte = (yaw: number): number =>
	fromNotchianYaw(yaw * FROM_NOTCH_BYTE);

/** Convert Notchian pitch byte (0-255) to radians. */
export const fromNotchianPitchByte = (pitch: number): number =>
	fromNotchianPitch(pitch * FROM_NOTCH_BYTE);

/** Convert Notchian velocity (fixed-point 1/8000 blocks/tick) to float Vec3. */
export const fromNotchVelocity = (vel: {
	x: number;
	y: number;
	z: number;
}): Vec3 =>
	vec3(vel.x * FROM_NOTCH_VEL, vel.y * FROM_NOTCH_VEL, vel.z * FROM_NOTCH_VEL);
