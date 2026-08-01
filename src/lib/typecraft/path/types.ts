/**
 * Collision-free numeric position hash.
 * Unique for x,z ∈ [-30000, 30000] and y ∈ [-64, 320].
 */
export const posHash = (x: number, y: number, z: number): number =>
	(x * 60001 + z) * 385 + (y + 64);

/** A discrete position node in the A* search graph (integer block coords). */
export type Move = {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly cost: number;
	readonly hash: number;
	readonly remainingBlocks: number;
	readonly toBreak: readonly {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	}[];
	readonly toPlace: readonly PlaceAction[];
	readonly parkour: boolean;
};

/** Goal interface — functions that drive A* toward a target. */
export type Goal = {
	readonly heuristic: (node: Move) => number;
	readonly isEnd: (node: Move) => boolean;
	readonly hasChanged?: () => boolean;
	readonly isValid?: () => boolean;
};

/** Result from an A* computation (single tick or final). */
export type PathResult = {
	readonly status: "success" | "timeout" | "noPath" | "partial";
	readonly path: readonly Move[];
	readonly cost: number;
	readonly visitedNodes: number;
	readonly generatedNodes: number;
	readonly time: number;
};

/** Configuration for the pathfinder. */
export type PathfinderConfig = {
	readonly thinkTimeout: number;
	readonly tickTimeout: number;
	readonly searchRadius: number;
	readonly maxDropDown: number;
	readonly reachDistance: number;
	readonly stuckTimeout: number;
};

/** Configuration for movement generation. */
export type MovementsConfig = {
	readonly canDig: boolean;
	readonly digCost: number;
	readonly placeCost: number;
	readonly liquidCost: number;
	readonly entityCost: number;
	readonly dontCreateFlow: boolean;
	readonly dontMineUnderFallingBlock: boolean;
	readonly allow1by1towers: boolean;
	readonly allowParkour: boolean;
	readonly allowSprinting: boolean;
	readonly allowEntityDetection: boolean;
	readonly maxDropDown: number;
	readonly infiniteLiquidDropdownDistance: boolean;
	readonly blocksCantBreak: ReadonlySet<number>;
	readonly blocksToAvoid: ReadonlySet<number>;
	readonly scaffoldingBlocks: readonly number[];
	readonly exclusionAreasStep: readonly ((
		x: number,
		y: number,
		z: number,
	) => number)[];
	readonly exclusionAreasBreak: readonly ((
		x: number,
		y: number,
		z: number,
	) => number)[];
	readonly exclusionAreasPlace: readonly ((
		x: number,
		y: number,
		z: number,
	) => number)[];
};

/** Create default movement configuration. */
export const defaultMovementsConfig = (): MovementsConfig => ({
	canDig: true,
	digCost: 1,
	placeCost: 1,
	liquidCost: 1,
	entityCost: 1,
	dontCreateFlow: true,
	dontMineUnderFallingBlock: true,
	allow1by1towers: true,
	allowParkour: true,
	allowSprinting: true,
	allowEntityDetection: true,
	maxDropDown: 4,
	infiniteLiquidDropdownDistance: true,
	blocksCantBreak: new Set(),
	blocksToAvoid: new Set(),
	scaffoldingBlocks: [],
	exclusionAreasStep: [],
	exclusionAreasBreak: [],
	exclusionAreasPlace: [],
});

/** Internal A* node — mutable for heap operations and index tracking. */
export type PathNode = {
	data: Move;
	g: number;
	h: number;
	f: number;
	parent: PathNode | null;
	heapIndex: number;
};

/** Persistent A* state for incremental computation. */
export type AStarContext = {
	readonly goal: Goal;
	readonly closedSet: Set<number>;
	readonly openMap: Map<number, PathNode>;
	readonly openHeap: PathNode[];
	bestNode: PathNode;
	readonly startTime: number;
	readonly maxCost: number;
};

/** A block placement action to execute during path following. */
export type PlaceAction = {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly dx: number;
	readonly dy: number;
	readonly dz: number;
	readonly jump?: boolean;
	readonly returnPos?: {
		readonly x: number;
		readonly y: number;
		readonly z: number;
	};
};

/** Simplified block query result for movement decisions. */
export type BlockQuery = {
	readonly safe: boolean;
	readonly physical: boolean;
	readonly liquid: boolean;
	/** Liquid that is specifically lava — never fall/swim into it. */
	readonly lava: boolean;
	readonly climbable: boolean;
	readonly height: number;
	readonly name: string;
	readonly replaceable: boolean;
	readonly canFall: boolean;
	readonly openable: boolean;
	readonly id: number;
};

/** Movement generator returned by createMovements. */
export type Movements = {
	readonly getNeighbors: (node: Move) => readonly Move[];
	readonly config: MovementsConfig;
};

/** The pathfinder object returned by createPathfinder. */
export type Pathfinder = {
	readonly setGoal: (goal: Goal | null, dynamic?: boolean) => void;
	readonly setMovements: (config: Partial<MovementsConfig>) => void;
	readonly stop: () => void;
	readonly isMoving: () => boolean;
	readonly isMining: () => boolean;
	readonly isBuilding: () => boolean;
	readonly goto: (goal: Goal) => Promise<void>;
	readonly getPathTo: (goal: Goal, timeout?: number) => PathResult;
	readonly bestHarvestTool: (block: unknown) => unknown | null;
	readonly config: PathfinderConfig;
};
