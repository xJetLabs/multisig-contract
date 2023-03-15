import { Blockchain, OpenedContract, TreasuryContract } from '@ton-community/sandbox';
import { beginCell, Cell, toNano, fromNano, Address, Dictionary } from 'ton-core';
import { MultisigWallet, OwnerValue } from '../wrappers/MultisigWallet';
import '@ton-community/test-utils';
import { sign_keyPair } from 'tweetnacl-ts';
import { compile } from '@ton-community/blueprint';

// const buf2hex = (n: Buffer)=>{return[...new Uint8Array(n)].map(n=>n.toString(16).padStart(2,"0")).join("")}

describe('MultisigWallet', () => {
    let multisigWalletCode: Cell;
    let blockchain: Blockchain;
    let owner: OpenedContract<TreasuryContract>;
    let another: OpenedContract<TreasuryContract>;

    let multisigWallet: OpenedContract<MultisigWallet>;
    let publicKey: Buffer, secretKey: Buffer;
    let anotherPublicKey: Buffer, anotherSecretKey: Buffer;

    let queryId = parseInt((Math.floor((Date.now() / 1000) + 60 * 60 * 24 * 3) * 2 ** 32).toString());

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

    queryId -= 10;
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
        // await blockchain.setVerbosityForAddress(multisigWallet.address, {
        //     blockchainLogs: true,
        //     vmLogs: 'vm_logs',
        // });
        const deployResult = await multisigWallet.sendDeploy(
            publicKey, secretKey, queryId
        );
        expect(deployResult.transactions).toHaveTransaction({
            to: multisigWallet.address,
            deploy: true,
        });
    });

    queryId += 1;
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
                .endCell(), queryId
        );
        expect(withdrawResult.transactions).toHaveTransaction({
            from: multisigWallet.address,
            to: owner.address,
            value: toNano('5'),
        });
    });

    queryId += 1;
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
                .endCell(), queryId
        );
        expect(true).toBe(true);
    });

    queryId += 1;
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
                .endCell(), queryId
        );

        let accountState = (await blockchain.getContract(multisigWallet.address)).accountState;
        if (accountState?.type !== 'active') throw new Error('Contract is not active');
        let accountData = accountState.state.data;
        if (!accountData) throw new Error('Contract has invalid data');
        const storedThreshold = accountData.beginParse().skip(64).loadCoins();
        expect(storedThreshold).toBe(2n);
    });

    queryId += 1;
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
                .endCell(), queryId
        );

        let account = (await blockchain.getContract(multisigWallet.address));
        expect(account.balance).toBeGreaterThanOrEqual(toNano('3.5'));
    });

    it('try withdraw, 2 signatures [approve proposal]', async () => {
        const withdrawResult = await multisigWallet.sendExternal(
            anotherPublicKey, anotherSecretKey,
            beginCell()
                .storeUint(0xa83505c8, 32)
                .endCell(), queryId
        );

        expect(withdrawResult.transactions).toHaveTransaction({
            from: multisigWallet.address,
            to: owner.address,
            value: toNano('2'),
        });
    });
});
