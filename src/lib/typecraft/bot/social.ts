/**
 * Social features — teams, scoreboards, boss bars, tablist.
 * Combines upstream team.js, scoreboard.js, boss_bar.js, tablist.js.
 */

import { parseChatMessage } from "../chat/index.ts";
import type {
	BossBar,
	BossBarColor,
	Bot,
	BotOptions,
	DisplaySlot,
	ScoreBoard,
	ScoreBoardItem,
	Team,
} from "./types.ts";

const BOSS_BAR_COLORS: readonly BossBarColor[] = [
	"pink",
	"blue",
	"red",
	"green",
	"yellow",
	"purple",
	"white",
];

const DISPLAY_SLOTS: Record<number, DisplaySlot> = {
	0: "list",
	1: "sidebar",
	2: "belowName",
};

export const initSocial = (bot: Bot, _options: BotOptions): void => {
	// ── Scoreboard ──

	bot.client.on("set_objective", (packet: Record<string, unknown>) => {
		const name = packet.name as string;
		const action = packet.action as number;

		if (action === 0) {
			// Create
			const scoreboard: ScoreBoard = {
				name,
				title: (packet.displayText as string) ?? name,
				itemsMap: {},
				items: [],
			};
			bot.scoreboards[name] = scoreboard;
			bot.emit("scoreboardCreated", scoreboard);
		} else if (action === 1) {
			// Remove
			const scoreboard = bot.scoreboards[name];
			if (scoreboard) {
				delete bot.scoreboards[name];
				bot.emit("scoreboardDeleted", scoreboard);
			}
		} else if (action === 2) {
			// Update title
			const scoreboard = bot.scoreboards[name];
			if (scoreboard) {
				scoreboard.title = (packet.displayText as string) ?? scoreboard.title;
				bot.emit("scoreboardTitleChanged", scoreboard);
			}
		}
	});

	bot.client.on(
		"scoreboard_display_objective",
		(packet: Record<string, unknown>) => {
			const position =
				DISPLAY_SLOTS[packet.position as number] ??
				(packet.position as DisplaySlot);
			const name = packet.name as string;
			const scoreboard = bot.scoreboards[name];
			if (scoreboard) {
				bot.scoreboard[String(position)] = scoreboard;
				bot.emit("scoreboardPosition", position, scoreboard);
			}
		},
	);

	bot.client.on("set_score", (packet: Record<string, unknown>) => {
		const scoreName = packet.scoreName as string;
		const itemName = packet.itemName as string;
		const value = packet.value as number;
		const action = packet.action as number;

		const scoreboard = bot.scoreboards[scoreName];
		if (!scoreboard) return;

		if (action === 0) {
			// Update/create score
			const item: ScoreBoardItem = {
				name: itemName,
				displayName: null,
				value,
			};
			scoreboard.itemsMap[itemName] = item;
			scoreboard.items = Object.values(scoreboard.itemsMap);
			bot.emit("scoreUpdated", scoreboard, value);
		} else if (action === 1) {
			// Remove score
			delete scoreboard.itemsMap[itemName];
			scoreboard.items = Object.values(scoreboard.itemsMap);
			bot.emit("scoreRemoved", scoreboard, value);
		}
	});

	// ── Teams ──

	bot.client.on("set_player_team", (packet: Record<string, unknown>) => {
		const teamName = packet.team as string;
		const mode = packet.mode as number;

		if (mode === 0) {
			// Create team
			const team: Team = {
				team: teamName,
				name: null,
				friendlyFire: (packet.friendlyFire as number) ?? 0,
				nameTagVisibility: (packet.nameTagVisibility as string) ?? "always",
				collisionRule: (packet.collisionRule as string) ?? "always",
				color: (packet.color as string) ?? "reset",
				prefix: null,
				suffix: null,
				memberMap: {},
				members: [],
			};

			const players = packet.players as string[] | undefined;
			if (players) {
				for (const p of players) {
					team.memberMap[p] = "";
					team.members.push(p);
				}
			}

			bot.teams[teamName] = team;
			for (const m of team.members) {
				bot.teamMap[m] = team;
			}
			bot.emit("teamCreated", team);
		} else if (mode === 1) {
			// Remove team
			const team = bot.teams[teamName];
			if (team) {
				for (const m of team.members) {
					delete bot.teamMap[m];
				}
				delete bot.teams[teamName];
				bot.emit("teamRemoved", team);
			}
		} else if (mode === 2) {
			// Update team info
			const team = bot.teams[teamName];
			if (team) {
				team.friendlyFire =
					(packet.friendlyFire as number) ?? team.friendlyFire;
				team.nameTagVisibility =
					(packet.nameTagVisibility as string) ?? team.nameTagVisibility;
				team.collisionRule =
					(packet.collisionRule as string) ?? team.collisionRule;
				team.color = (packet.color as string) ?? team.color;
				bot.emit("teamUpdated", team);
			}
		} else if (mode === 3) {
			// Add players
			const team = bot.teams[teamName];
			if (team) {
				const players = packet.players as string[] | undefined;
				if (players) {
					for (const p of players) {
						team.memberMap[p] = "";
						if (!team.members.includes(p)) team.members.push(p);
						bot.teamMap[p] = team;
					}
				}
				bot.emit("teamMemberAdded", team);
			}
		} else if (mode === 4) {
			// Remove players
			const team = bot.teams[teamName];
			if (team) {
				const players = packet.players as string[] | undefined;
				if (players) {
					for (const p of players) {
						delete team.memberMap[p];
						team.members = team.members.filter((m) => m !== p);
						delete bot.teamMap[p];
					}
				}
				bot.emit("teamMemberRemoved", team);
			}
		}
	});

	// ── Boss bars ──

	bot.client.on("boss_event", (packet: Record<string, unknown>) => {
		const entityUUID = packet.entityUUID as string;
		const action = packet.action as number;

		if (action === 0) {
			// Add
			const bar: BossBar = {
				entityUUID,
				title: null as never,
				health: (packet.health as number) ?? 0,
				dividers: (packet.dividers as number) ?? 0,
				color: BOSS_BAR_COLORS[(packet.color as number) ?? 0] ?? "pink",
				shouldDarkenSky: Boolean((packet.flags as number) ?? 0 & 0x1),
				isDragonBar: Boolean((packet.flags as number) ?? 0 & 0x2),
				shouldCreateFog: Boolean((packet.flags as number) ?? 0 & 0x4),
			};

			if (packet.title) {
				try {
					bar.title = parseChatMessage(
						typeof packet.title === "string"
							? JSON.parse(packet.title as string)
							: packet.title,
					);
				} catch {
					// Ignore
				}
			}

			bot.bossBars[entityUUID] = bar;
			bot.emit("bossBarCreated", bar);
		} else if (action === 1) {
			// Remove
			const bar = bot.bossBars[entityUUID];
			if (bar) {
				delete bot.bossBars[entityUUID];
				bot.emit("bossBarDeleted", bar);
			}
		} else if (action === 2) {
			// Update health
			const bar = bot.bossBars[entityUUID];
			if (bar) {
				bar.health = (packet.health as number) ?? bar.health;
				bot.emit("bossBarUpdated", bar);
			}
		} else if (action === 3) {
			// Update title
			const bar = bot.bossBars[entityUUID];
			if (bar && packet.title) {
				try {
					bar.title = parseChatMessage(
						typeof packet.title === "string"
							? JSON.parse(packet.title as string)
							: packet.title,
					);
				} catch {
					// Ignore
				}
				bot.emit("bossBarUpdated", bar);
			}
		} else if (action === 4) {
			// Update style
			const bar = bot.bossBars[entityUUID];
			if (bar) {
				bar.color = BOSS_BAR_COLORS[(packet.color as number) ?? 0] ?? bar.color;
				bar.dividers = (packet.dividers as number) ?? bar.dividers;
				bot.emit("bossBarUpdated", bar);
			}
		} else if (action === 5) {
			// Update flags
			const bar = bot.bossBars[entityUUID];
			if (bar) {
				const flags = (packet.flags as number) ?? 0;
				bar.shouldDarkenSky = Boolean(flags & 0x1);
				bar.isDragonBar = Boolean(flags & 0x2);
				bar.shouldCreateFog = Boolean(flags & 0x4);
				bot.emit("bossBarUpdated", bar);
			}
		}
	});

	// ── Tablist ──

	bot.client.on("tab_list", (packet: Record<string, unknown>) => {
		try {
			const header = packet.header as unknown;
			const footer = packet.footer as unknown;

			if (header) {
				bot.tablist.header = parseChatMessage(
					typeof header === "string" ? JSON.parse(header) : header,
				);
			}
			if (footer) {
				bot.tablist.footer = parseChatMessage(
					typeof footer === "string" ? JSON.parse(footer) : footer,
				);
			}
		} catch {
			// Ignore parse errors
		}
	});
};
