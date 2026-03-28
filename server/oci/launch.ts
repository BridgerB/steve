#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config as userConfig } from "./config.ts";

const execFileAsync = promisify(execFile);

const config = {
	displayName: "steve-server",
	availabilityDomain: "ndHF:PHX-AD-1",
	compartmentId: userConfig.tenancyId,
	shape: "VM.Standard.A1.Flex",
	ocpus: 4,
	memoryInGBs: 24,
	imageId: userConfig.imageId,
	subnetId: userConfig.subnetId,
	sshKeyFile: `${process.env.HOME}/.ssh/id_ed25519.pub`,
	bootVolumeSizeInGBs: 100,
};

async function runCommand(args: string[]): Promise<string> {
	const { stdout, stderr } = await execFileAsync("oci", args).catch((err) => {
		throw new Error(`Command failed: ${err.stderr ?? err.message}`);
	});
	return stdout;
}

async function launchInstance() {
	console.log("Launching OCI instance...");

	const output = await runCommand([
		"compute",
		"instance",
		"launch",
		"--display-name",
		config.displayName,
		"--availability-domain",
		config.availabilityDomain,
		"--compartment-id",
		config.compartmentId,
		"--shape",
		config.shape,
		"--shape-config",
		JSON.stringify({ ocpus: config.ocpus, memoryInGBs: config.memoryInGBs }),
		"--image-id",
		config.imageId,
		"--subnet-id",
		config.subnetId,
		"--assign-public-ip",
		"true",
		"--ssh-authorized-keys-file",
		config.sshKeyFile,
		"--boot-volume-size-in-gbs",
		config.bootVolumeSizeInGBs.toString(),
		"--auth",
		"security_token",
	]);

	const instanceId = JSON.parse(output).data.id;
	console.log(`Instance created: ${instanceId}`);

	console.log("Waiting for instance to reach RUNNING state...");
	while (true) {
		const statusOutput = await runCommand([
			"compute",
			"instance",
			"get",
			"--instance-id",
			instanceId,
			"--auth",
			"security_token",
		]);
		const state = JSON.parse(statusOutput).data["lifecycle-state"];
		console.log(`State: ${state}`);

		if (state === "RUNNING") {
			const vnicOutput = await runCommand([
				"compute",
				"instance",
				"list-vnics",
				"--instance-id",
				instanceId,
				"--auth",
				"security_token",
			]);
			const publicIp = JSON.parse(vnicOutput).data[0]["public-ip"];

			console.log(`\nInstance is RUNNING!`);
			console.log(`Instance ID: ${instanceId}`);
			console.log(`Public IP: ${publicIp}`);
			console.log(`\nNext step: cd server/oci && nix run .#deploy`);
			break;
		}

		await new Promise((resolve) => setTimeout(resolve, 5000));
	}
}

launchInstance().catch((err) => {
	console.error("Error:", err.message);
	process.exit(1);
});
