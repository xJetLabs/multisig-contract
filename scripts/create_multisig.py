
from multisig_wallet_cv1 import MultisigWalletCV1
from tonsdk.utils import Address
from nacl.signing import SigningKey
from _utils import send_boc, get_identity

if __name__ == '__main__':
    public_key, secret_key = get_identity()
    multisig = MultisigWalletCV1(
        owners=[
            {
                'public_key': public_key,
                'weight': 1
            }
        ],
        threshold=1,
        private_key=secret_key,
        public_key=public_key
    )
    multisig_address = multisig.address.to_string(1, 1, 1)
    print(f"Multisig address: {multisig_address}")
    send_boc(
        multisig.create_init_external_message()['message'].to_boc(False)
    )
    print(f"Sent init message to multisig. Topup balance and run this again.")

