/**
 * Physics loop — 50ms fixed timestep, movement packets, control state, look.
 * Wires src/physics/ engine to the bot.
 */

import {
	applyPlayerState,
	createPhysics,
	createPhysicsWorld,
	createPlayerState,
	type PhysicsWorld,
	type PlayerControls,
} from "../physics/index.ts";
import { subtract, type Vec3, vec3 } from "../vec3/index.ts";
import {
	fromNotchianPitch,
	fromNotchianYaw,
	toNotchianPitch,
	toNotchianYaw,
} from "./conversions.ts";
import type { Bot, BotOptions, ControlState } from "./types.ts";

/** Writable version of Vec3 for entity position/velocity mutation. */
type MutableVec3 = { x: number; y: number; z: number };

const PHYSICS_INTERVAL_MS = 50;

export const initPhysics = (bot: Bot, _options: BotOptions): void => {
	let physicsTimer: ReturnType<typeof setInterval> | null = null;
	let shouldUsePhysics = false;
	let lastSentPos = vec3(0, 0, 0);
	let lastSentYaw = 0;
	let lastSentPitch = 0;
	let positionUpdateTimer = 0;
	let targetYaw: number | null = null;
	let targetPitch: number | null = null;
	let lookResolve: (() => void) | null = null;
	let physicsWorld: PhysicsWorld | null = null;

	// ── Control state ──

	bot.setControlState = (control: ControlState, state: boolean) => {
		(bot.controlState as Record<string, boolean>)[control] = state;
	};

	bot.getControlState = (control: ControlState): boolean =>
		bot.controlState[control] ?? false;

	bot.clearControlStates = () => {
		for (const key of Object.keys(bot.controlState)) {
			(bot.controlState as Record<string, boolean>)[key] = false;
		}
	};

	// ── Look ──

	let lockedLookTarget: Vec3 | null = null;

	bot.lockLook = (pos: Vec3) => {
		lockedLookTarget = pos;
	};
	bot.unlockLook = () => {
		lockedLookTarget = null;
	};

	bot.look = async (yaw: number, pitch: number, force?: boolean) => {
		if (force) {
			// Instant look
			bot.entity.yaw = yaw;
			bot.entity.pitch = pitch;
			targetYaw = null;
			targetPitch = null;
			if (lookResolve) {
				lookResolve();
				lookResolve = null;
			}
			return;
		}

		// Gradual lerp — set target and wait for physics ticks to reach it
		targetYaw = yaw;
		targetPitch = pitch;

		return new Promise<void>((resolve) => {
			lookResolve = resolve;
		});
	};

	bot.lookAt = async (point: Vec3, force?: boolean) => {
		const eyePos = vec3(
			bot.entity.position.x,
			bot.entity.position.y + 1.62,
			bot.entity.position.z,
		);
		const delta = subtract(point, eyePos);
		const yaw = Math.atan2(-delta.x, -delta.z);
		const groundDist = Math.sqrt(delta.x * delta.x + delta.z * delta.z);
		const pitch = Math.atan2(delta.y, groundDist);
		return bot.look(yaw, pitch, force);
	};

	// ── Wait for ticks ──

	bot.waitForTicks = async (ticks: number): Promise<void> => {
		let remaining = ticks;
		return new Promise<void>((resolve) => {
			const onTick = () => {
				remaining--;
				if (remaining <= 0) {
					bot.removeListener("physicsTick", onTick);
					resolve();
				}
			};
			bot.on("physicsTick", onTick);
		});
	};

	// ── Elytra fly ──

	bot.elytraFly = async () => {
		if (!bot.entity.onGround && !bot.entity.elytraFlying) {
			bot.client.write("player_command", {
				entityId: bot.entity.id,
				actionId: bot.supportFeature("entityActionUsesStringMapper")
					? "start_elytra_flying"
					: 8,
				jumpBoost: 0,
			});
		}
	};

	// ── Teleport handling ──

	bot.client.on("player_position", (packet: Record<string, unknown>) => {
		const flags = (packet.flags ?? {}) as Record<string, boolean>;
		const pos = bot.entity.position as MutableVec3;

		// Apply position (relative or absolute based on flags)
		pos.x = flags.x
			? bot.entity.position.x + (packet.x as number)
			: (packet.x as number);
		pos.y = flags.y
			? bot.entity.position.y + (packet.y as number)
			: (packet.y as number);
		pos.z = flags.z
			? bot.entity.position.z + (packet.z as number)
			: (packet.z as number);

		bot.entity.yaw = flags.yaw
			? bot.entity.yaw + fromNotchianYaw(packet.yaw as number)
			: fromNotchianYaw(packet.yaw as number);
		bot.entity.pitch = flags.pitch
			? bot.entity.pitch + fromNotchianPitch(packet.pitch as number)
			: fromNotchianPitch(packet.pitch as number);

		const vel = bot.entity.velocity as MutableVec3;
		vel.x = 0;
		vel.y = 0;
		vel.z = 0;

		// Confirm teleport
		if (packet.teleportId != null) {
			bot.client.write("accept_teleportation", {
				teleportId: packet.teleportId,
			});
		}

		shouldUsePhysics = true;
		bot.emit("forcedMove");
	});

	// ── Explosion knockback ──

	bot.client.on("explode", (packet: Record<string, unknown>) => {
		if (packet.playerMotionX != null) {
			const vel = bot.entity.velocity as MutableVec3;
			vel.x += packet.playerMotionX as number;
			vel.y += packet.playerMotionY as number;
			vel.z += packet.playerMotionZ as number;
		}
	});

	// ── Physics loop ──

	const doPhysics = () => {
		if (!bot.registry || !bot.world || !shouldUsePhysics) return;
		if (!bot.physicsEnabled) return;

		// Initialize physics engine lazily
		if (!bot.physics) {
			bot.physics = createPhysics(bot.registry);
			physicsWorld = createPhysicsWorld(bot.world);
		}

		// Create player state snapshot
		const controls: PlayerControls = {
			forward: bot.controlState.forward,
			back: bot.controlState.back,
			left: bot.controlState.left,
			right: bot.controlState.right,
			jump: bot.controlState.jump,
			sprint: bot.controlState.sprint,
			sneak: bot.controlState.sneak,
		};

		const state = createPlayerState(bot.registry, bot.entity, controls);

		// Simulate
		bot.physics.simulatePlayer(state, physicsWorld!);

		// Apply back to entity
		applyPlayerState(state, bot.entity);

		// Apply locked look target (dig/place hold)
		if (lockedLookTarget) {
			const eyePos = vec3(
				bot.entity.position.x,
				bot.entity.position.y + 1.62,
				bot.entity.position.z,
			);
			const delta = subtract(lockedLookTarget, eyePos);
			bot.entity.yaw = Math.atan2(-delta.x, -delta.z);
			const groundDist = Math.sqrt(delta.x * delta.x + delta.z * delta.z);
			bot.entity.pitch = Math.atan2(delta.y, groundDist);
		}

		// Interpolate look toward target
		if (!lockedLookTarget && targetYaw !== null && targetPitch !== null) {
			const LERP_FACTOR = 0.5;
			const EPSILON = 0.01;

			// Normalize yaw difference to [-PI, PI]
			let yawDiff = targetYaw - bot.entity.yaw;
			while (yawDiff > Math.PI) yawDiff -= 2 * Math.PI;
			while (yawDiff < -Math.PI) yawDiff += 2 * Math.PI;

			const pitchDiff = targetPitch - bot.entity.pitch;

			if (Math.abs(yawDiff) < EPSILON && Math.abs(pitchDiff) < EPSILON) {
				bot.entity.yaw = targetYaw;
				bot.entity.pitch = targetPitch;
				targetYaw = null;
				targetPitch = null;
				if (lookResolve) {
					lookResolve();
					lookResolve = null;
				}
			} else {
				bot.entity.yaw += yawDiff * LERP_FACTOR;
				bot.entity.pitch += pitchDiff * LERP_FACTOR;
			}
		}

		bot.emit("physicsTick");

		// Send position packet
		sendPosition();
	};

	const sendPosition = () => {
		const pos = bot.entity.position;
		const yaw = bot.entity.yaw;
		const pitch = bot.entity.pitch;
		const onGround = bot.entity.onGround;

		// 1.21.2+ uses MovementFlags bitfield instead of plain onGround boolean
		const movementFlags = {
			flags: {
				onGround: onGround ? 1 : 0,
				horizontalCollision: 0,
				_padding: 0,
			},
		};

		const posChanged =
			pos.x !== lastSentPos.x ||
			pos.y !== lastSentPos.y ||
			pos.z !== lastSentPos.z;
		const lookChanged = yaw !== lastSentYaw || pitch !== lastSentPitch;

		positionUpdateTimer++;
		const forceUpdate = positionUpdateTimer >= 20; // Every 1 second

		let packetType: string;
		if (posChanged && lookChanged) {
			packetType = "move_player_pos_rot";
			bot.client.write("move_player_pos_rot", {
				x: pos.x,
				y: pos.y,
				z: pos.z,
				yaw: toNotchianYaw(yaw),
				pitch: toNotchianPitch(pitch),
				...movementFlags,
			});
		} else if (posChanged) {
			packetType = "move_player_pos";
			bot.client.write("move_player_pos", {
				x: pos.x,
				y: pos.y,
				z: pos.z,
				...movementFlags,
			});
		} else if (lookChanged) {
			packetType = "move_player_rot";
			bot.client.write("move_player_rot", {
				yaw: toNotchianYaw(yaw),
				pitch: toNotchianPitch(pitch),
				...movementFlags,
			});
		} else if (forceUpdate) {
			packetType = "move_player_status_only";
			bot.client.write("move_player_status_only", { ...movementFlags });
		} else {
			return;
		}

		bot.emit("debug", "packet_tx", {
			name: packetType,
			x: pos.x.toFixed(1),
			y: pos.y.toFixed(1),
			z: pos.z.toFixed(1),
		});

		positionUpdateTimer = 0;
		if (posChanged) {
			lastSentPos = { ...pos };
		}
		if (lookChanged) {
			lastSentYaw = yaw;
			lastSentPitch = pitch;
		}

		if (posChanged || lookChanged) {
			bot.emit("move", pos);
		}
	};

	// Start physics on login
	bot.client.on("login", () => {
		if (!physicsTimer) {
			physicsTimer = setInterval(doPhysics, PHYSICS_INTERVAL_MS);
		}
	});

	// Stop on disconnect
	bot.on("end", () => {
		if (physicsTimer) {
			clearInterval(physicsTimer);
			physicsTimer = null;
		}
		shouldUsePhysics = false;
	});

	// Pause physics when mounted
	bot.on("mount", () => {
		shouldUsePhysics = false;
	});

	bot.on("respawn", () => {
		shouldUsePhysics = false;
	});
};
