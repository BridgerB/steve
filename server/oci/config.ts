// OCI configuration for the steve server
export const config = {
	// OCI Tenancy OCID
	tenancyId:
		"ocid1.tenancy.oc1..aaaaaaaaxce66srgd3kttidixoktcxyqdbmc5spi4vnhktccnj5uvyeyuddq",

	// NixOS ARM image OCID (for Phoenix region)
	imageId:
		"ocid1.image.oc1.phx.aaaaaaaagslm6zxz4ab6pivcatx6wpvl3hkid6ywhsfx4mvlckqmbceyffoa",

	// Subnet OCID (for Phoenix region)
	subnetId:
		"ocid1.subnet.oc1.phx.aaaaaaaas5lnssbgrqqfzybiypmm3rvqzdqydej35pby6l3lt5ij5eqideba",

	// SSH public keys
	sshKeys: [
		"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID5mdblREEnjNE8hqgViMurQOrDMPVeW46u9Jbw1oqwB bridger@nixos",
		"sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIErSAuIjm52nSN7ZihpmbB6MDg+62WBs8sq+ME9B02bjAAAABHNzaDo= yubico-security-key-c-nfc-auth",
	],
} as const;
