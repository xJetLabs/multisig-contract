import { Blockchain, OpenedContract, TreasuryContract } from '@ton-community/sandbox';
import { beginCell, Cell, toNano, fromNano, Address, Dictionary } from 'ton-core';
import { MultisigWallet, OwnerValue } from '../wrappers/MultisigWallet';
import '@ton-community/test-utils';
import { sign_keyPair } from 'tweetnacl-ts';
import { compile } from '@ton-community/blueprint';
import exp from 'constants';

// const buf2hex = (n: Buffer)=>{return[...new Uint8Array(n)].map(n=>n.toString(16).padStart(2,"0")).join("")}

describe('MultisigWallet', () => {
    let multisigWalletCode: Cell;
    let blockchain: Blockchain;
    let owner: OpenedContract<TreasuryContract>;
    let another: OpenedContract<TreasuryContract>;

    let multisigWallet: OpenedContract<MultisigWallet>;
    let publicKey: Buffer, secretKey: Buffer;
    let anotherPublicKey: Buffer, anotherSecretKey: Buffer;

    let queryId = BigInt((Math.floor((Date.now() / 1000) + 60 * 60 * 24 * 3))) * BigInt(2 ** 32);
    let floodQueryId = BigInt((Math.floor((Date.now() / 1000) + 180))) * BigInt(2 ** 32);

    beforeAll(async () => {
        multisigWalletCode = await compile('MultisigWallet');
        blockchain = await Blockchain.create();
        owner = await blockchain.treasury('owner');
        another = await blockchain.treasury('another');

        let keyPair = sign_keyPair();
        publicKey = Buffer.from(keyPair.publicKey);
        secretKey = Buffer.from(keyPair.secretKey);

        keyPair = sign_keyPair();
        anotherPublicKey = Buffer.from(keyPair.publicKey);
        anotherSecretKey = Buffer.from(keyPair.secretKey);
    });

    it('should deploy & put test coins', async () => {
        multisigWallet = blockchain.openContract(
            MultisigWallet.createFromConfig({
                threshold: 1,
                owners: [{
                    publicKey: publicKey,
                    weight: 1
                }]
            }, multisigWalletCode)
        );
        
        await owner.send({
            to: multisigWallet.address,
            value: toNano('10'),
            bounce: false
        });
        await blockchain.setVerbosityForAddress(multisigWallet.address, {
            blockchainLogs: true,
            vmLogs: 'vm_logs',
        });
        const deployResult = await multisigWallet.sendDeploy(
            publicKey, secretKey, floodQueryId - 11n
        );
        expect(deployResult.transactions).toHaveTransaction({
            to: multisigWallet.address,
            deploy: true,
        });
    });

    it('try withdraw, 1 signature', async () => {
        const withdrawResult = await multisigWallet.sendExternal(
            publicKey, secretKey,
            beginCell()
                .storeUint(0xa83505c8, 32)
                .storeRef(
                    beginCell()
                        .storeUint(1, 8)
                        .storeRef(
                            beginCell()
                                .storeUint(0x18, 6)
                                .storeAddress(owner.address)
                                .storeCoins(toNano('5'))
                                .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
                                .endCell()
                        )
                        .endCell()
                )
                .endCell(), floodQueryId - 10n
        );
        expect(withdrawResult.transactions).toHaveTransaction({
            from: multisigWallet.address,
            to: owner.address,
            value: toNano('5'),
        });
    });

    it('add owner', async () => {
        await multisigWallet.sendExternal(
            publicKey, secretKey,
            beginCell()
                .storeUint(0xa83505c8, 32)
                .storeRef(
                    beginCell()
                        .storeUint(255, 8)
                        .storeUint(0x03129f04, 32)
                        .storeBuffer(anotherPublicKey)
                        .storeUint(0, 1)
                        .storeUint(1, 16)
                        .endCell()
                )
                .endCell(), floodQueryId - 9n
        );
        expect(true).toBe(true);
    });

    it('edit threshold', async () => {
        await multisigWallet.sendExternal(
            publicKey, secretKey,
            beginCell()
                .storeUint(0xa83505c8, 32)
                .storeRef(
                    beginCell()
                        .storeUint(255, 8)
                        .storeUint(0x81842e3d, 32)
                        .storeCoins(2n)
                        .endCell()
                )
                .endCell(), floodQueryId - 8n
        );

        let accountState = (await blockchain.getContract(multisigWallet.address)).accountState;
        if (accountState?.type !== 'active') throw new Error('Contract is not active');
        let accountData = accountState.state.data;
        if (!accountData) throw new Error('Contract has invalid data');
        const storedThreshold = accountData.beginParse().skip(128).loadCoins();
        expect(storedThreshold).toBe(2n);
    });

    it('try withdraw, 2 signatures [add proposal]', async () => {
        await multisigWallet.sendExternal(
            publicKey, secretKey,
            beginCell()
                .storeUint(0xa83505c8, 32)
                .storeRef(
                    beginCell()
                        .storeUint(1, 8)
                        .storeRef(
                            beginCell()
                                .storeUint(0x18, 6)
                                .storeAddress(owner.address)
                                .storeCoins(toNano('2'))
                                .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
                                .endCell()
                        )
                        .endCell()
                )
                .endCell(), floodQueryId - 7n
        );

        let account = (await blockchain.getContract(multisigWallet.address));
        expect(account.balance).toBeGreaterThanOrEqual(toNano('3.5'));
    });

    jest.setTimeout(72000);
    it('owner flood timeout', async () => {
        let errored = false;
        for (let i = 1; i < 12; i++) {
            try {
                await multisigWallet.sendExternal(
                    publicKey, secretKey,
                    beginCell()
                        .storeUint(0xa83505c8, 32)
                        .storeRef(
                            beginCell()
                                .storeUint(1, 8)
                                .storeRef(
                                    beginCell()
                                        .storeUint(0x18, 6)
                                        .storeAddress(owner.address)
                                        .storeCoins(toNano('2'))
                                        .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
                                        .endCell()
                                )
                                .storeUint(255, 8) // reset flood
                                .storeUint(0x03129f04, 32)
                                .storeBuffer(publicKey)
                                .storeUint(0, 1)
                                .storeUint(1, 16)
                                .endCell()
                        ).endCell(), floodQueryId + BigInt(i)
                );
            } catch (e) {
                errored = true;
            }
        };
        expect(errored).toBe(true);

        await new Promise(f => setTimeout(f, 70000));
    });

    it('try withdraw, 2 signatures [approve proposal]', async () => {
        let { stack } = (await blockchain.getContract(multisigWallet.address)).get('get_owner', [
            {type: 'int', value: bufferToBigInt(publicKey)}
        ]);
        if (stack[0].type == 'int') {
            console.log("Flood [ROOT] =", stack[0].value);
        }
        
        const withdrawResult = await multisigWallet.sendExternal(
            anotherPublicKey, anotherSecretKey,
            beginCell()
                .storeUint(0xa83505c8, 32)
                .endCell(), floodQueryId - 7n
        );
        floodQueryId += 15n;

        expect(withdrawResult.transactions).toHaveTransaction({
            from: multisigWallet.address,
            to: owner.address,
            value: toNano('2'),
        });
    });

    it('remove owner', async () => {
        await multisigWallet.sendExternal(
            publicKey, secretKey,
            beginCell()
                .storeUint(0xa83505c8, 32)
                .storeRef(
                    beginCell()
                        .storeUint(255, 8)
                        .storeUint(0x03129f04, 32)
                        .storeBuffer(anotherPublicKey)
                        .storeUint(1, 1)
                        .endCell()
                )
                .endCell(), queryId - 5n
        );
        await multisigWallet.sendExternal(
            anotherPublicKey, anotherSecretKey,
            beginCell()
                .storeUint(0xa83505c8, 32)
                .endCell(), queryId - 5n
        );

        let accountState = (await blockchain.getContract(multisigWallet.address)).accountState;
        if (accountState?.type !== 'active') throw new Error('Contract is not active');
        let accountData = accountState.state.data;
        if (!accountData) throw new Error('Contract has invalid data');
        const storedThreshold = accountData.beginParse().skip(128).loadCoins();
        expect(storedThreshold).toBe(1n);
        
        let errored = false;
        try {
            await multisigWallet.sendExternal(
                anotherPublicKey, anotherSecretKey,
                beginCell()
                    .storeUint(0xa83505c8, 32)
                    .storeRef(
                        beginCell()
                            .storeUint(1, 8)
                            .storeRef(
                                beginCell()
                                    .storeUint(0x18, 6)
                                    .storeAddress(owner.address)
                                    .storeCoins(toNano('2'))
                                    .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
                                    .endCell()
                            )
                            .endCell()
                    )
                    .endCell(), queryId - 4n
            );
        } catch (e) {
            errored = true;
        }
        expect(errored).toBe(true);
    });

    it('returns another owner', async () => {
        await multisigWallet.sendExternal(
            publicKey, secretKey,
            beginCell()
                .storeUint(0xa83505c8, 32)
                .storeRef(
                    beginCell()
                        .storeUint(255, 8)
                        .storeUint(0x03129f04, 32)
                        .storeBuffer(anotherPublicKey)
                        .storeUint(0, 1)
                        .storeUint(0, 16)
                        .endCell()
                )
                .endCell(), queryId - 3n
        );

        let accountState = (await blockchain.getContract(multisigWallet.address)).accountState;
        if (accountState?.type !== 'active') throw new Error('Contract is not active');
        let accountData = accountState.state.data;
        if (!accountData) throw new Error('Contract has invalid data');
        const storedThreshold = accountData.beginParse().skip(128).loadCoins();
        expect(storedThreshold).toBe(1n);
    });

    it('another owner tries flood', async () => {
        let errored = false;
        for (let i = 1; i < 12; i++) {
            try {
                await multisigWallet.sendExternal(
                    anotherPublicKey, anotherSecretKey,
                    beginCell()
                        .storeUint(0xa83505c8, 32)
                        .storeRef(
                            beginCell()
                                .storeUint(1, 8)
                                .storeRef(
                                    beginCell()
                                        .storeUint(0x18, 6)
                                        .storeAddress(owner.address)
                                        .storeCoins(toNano('2'))
                                        .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
                                        .endCell()
                                )
                                .endCell()
                        ).endCell(), queryId + BigInt(i)
                );
            } catch (e) {
                errored = true;
            }
        };
        expect(errored).toBe(true);
    });

    function bufferToBigInt(buffer: Buffer, start = 0, end = buffer.length) {
        const bufferAsHexString = buffer.slice(start, end).toString("hex");
        return BigInt(`0x${bufferAsHexString}`);
      }

    it('accept "another" proposal', async () => {
        const acceptResult = await multisigWallet.sendExternal(
            publicKey, secretKey,
            beginCell()
                .storeUint(0xa83505c8, 32)
                .endCell(), queryId + BigInt(3)
        );
        expect(acceptResult.transactions).toHaveTransaction({
            from: multisigWallet.address,
            to: owner.address,
            value: toNano('2'),
        });

        let { stack } = (await blockchain.getContract(multisigWallet.address)).get('get_owner', [
            {type: 'int', value: bufferToBigInt(anotherPublicKey)}
        ]);
        if (stack[0].type == 'int') {
            console.log("Flood =", stack[0].value);
        }

        await multisigWallet.sendExternal(
            anotherPublicKey, anotherSecretKey,
            beginCell()
                .storeUint(0xa83505c8, 32)
                .storeRef(
                    beginCell()
                        .storeUint(1, 8)
                        .storeRef(
                            beginCell()
                                .storeUint(0x18, 6)
                                .storeAddress(owner.address)
                                .storeCoins(toNano('2'))
                                .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
                                .endCell()
                        )
                        .endCell()
                ).endCell(), queryId + 10n
        );
    });
});
