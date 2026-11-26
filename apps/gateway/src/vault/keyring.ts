import { deriveVaultKey, type VaultKey } from "./envelope.ts";

export class VaultKeyring {
  private keys: [VaultKey, ...VaultKey[]];

  constructor(keyMaterial: string, previousKeyMaterials: string[] = []) {
    const [active, ...rest] = [keyMaterial, ...previousKeyMaterials].map(deriveVaultKey);
    if (!active) throw new Error("a vault keyring needs at least one key");
    this.keys = [active, ...rest];
  }

  get active(): VaultKey {
    return this.keys[0];
  }

  find(id: string): VaultKey | undefined {
    return this.keys.find((candidate) => candidate.id === id);
  }

  activate(next: VaultKey): void {
    this.keys = [next, ...this.keys.filter((candidate) => candidate.id !== next.id)];
  }
}
