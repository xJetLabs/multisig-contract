import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano, Dictionary, DictionaryValue, Slice } from 'ton-core';
import { sign_detached } from 'tweetnacl-ts';

export type Owner = {
    publicKey: Buffer;
    weight: number;
}

export type MultisigWalletConfig = {
    threshold: number;
    owners: Owner[];
};

export type OwnerValue = {
    flood: number;
    weight: number;
};

export const OnwerValues: DictionaryValue<OwnerValue> = {
    serialize: (src: OwnerValue, builder) => {
        builder
            .storeUint(src.flood, 8)
            .storeUint(src.weight, 16)
    },
    parse: (src) => {
        return {
            flood: src.loadUint(8),
            weight: src.loadUint(16)
        }
    },
};

export function multisigWalletConfigToCell(config: MultisigWalletConfig): Cell {
    const owners = Dictionary.empty(Dictionary.Keys.Buffer(32), OnwerValues);
    for (let _owner of config.owners)
        owners.set(_owner.publicKey, { flood: 0, weight: _owner.weight });

    return beginCell()
        .storeUint(0, 64)
        .storeUint(0, 64)
        .storeCoins(config.threshold)
        .storeDict(owners)
        .storeUint(0, 1)
        .endCell();
}

export class MultisigWallet implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new MultisigWallet(address);
    }

    static createFromConfig(config: MultisigWalletConfig, code: Cell, workchain = 0) {
        const data = multisigWalletConfigToCell(config);
        const init = { code, data };
        return new MultisigWallet(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, publicKey: Buffer, secretKey: Buffer, queryId: bigint) {
        return await this.sendExternal(provider, publicKey, secretKey, beginCell().storeUint(0, 32).endCell(), queryId);
    }

    async sendExternal(provider: ContractProvider, publicKey: Buffer, secretKey: Buffer, message: Cell, queryId: bigint) {
        message = beginCell()
            .storeBuffer(publicKey)
            .storeUint(queryId, 64)
            .storeSlice(message.beginParse())
            .endCell();

        let signature = sign_detached(message.hash(), secretKey);
        return await provider.external(
            beginCell()
                .storeBuffer(Buffer.from(signature))
                .storeSlice(message.beginParse())
                .endCell()
        );
    }
}
