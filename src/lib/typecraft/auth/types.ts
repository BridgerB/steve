/** Microsoft auth token response from login.live.com */
export type MsaToken = {
	readonly access_token: string;
	readonly refresh_token: string;
	readonly expires_in: number;
	readonly obtainedOn: number;
};

/** Xbox Live XSTS token data */
export type XboxToken = {
	readonly userXUID: string;
	readonly userHash: string;
	readonly XSTSToken: string;
	readonly expiresOn: string;
};

/** Xbox user/device token response */
export type XboxUserToken = {
	readonly Token: string;
	readonly NotAfter: string;
};

/** Minecraft Java access token response */
export type MinecraftToken = {
	readonly access_token: string;
	readonly expires_in: number;
	readonly obtainedOn: number;
};

/** Minecraft profile from /minecraft/profile */
export type MinecraftProfile = {
	readonly id: string;
	readonly name: string;
	readonly skins?: readonly unknown[];
	readonly capes?: readonly unknown[];
};

/** Device code response from login.live.com */
export type DeviceCodeResponse = {
	readonly user_code: string;
	readonly device_code: string;
	readonly verification_uri: string;
	readonly expires_in: number;
	readonly interval: number;
};

/** Auth result returned to callers */
export type AuthResult = {
	readonly accessToken: string;
	readonly username: string;
	readonly uuid: string;
};

/** Options for authenticateMicrosoft */
export type AuthOptions = {
	readonly username: string;
	readonly profilesFolder?: string;
	readonly onMsaCode?: (data: {
		user_code: string;
		verification_uri: string;
	}) => void;
};
