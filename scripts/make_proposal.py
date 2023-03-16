from multisig_wallet_cv1 import MultisigWalletCV1
from subprocess import Popen, PIPE
from tonsdk.utils import Address
from tonsdk.boc import begin_cell, Cell
from nacl.signing import SigningKey
from _utils import send_boc, get_identity
import sys, os
import time

if __name__ == '__main__':
    public_key, secret_key = get_identity()
    print(f"Public key: {public_key.hex()}")
    multisig = MultisigWalletCV1(
        owners=[
            {
                'public_key': public_key,
                'weight': 1
            }
        ],
        threshold=1,
        address=Address(sys.argv[1]),
        private_key=secret_key,
        public_key=public_key
    )
    multisig_address = multisig.address.to_string(1, 1, 1)
    print(f"Multisig address: {multisig_address}")
    
    args = sys.argv[2]
    query_id = int(args) if args.isdigit() else int(time.time() + 259200) << 32
    messages = None
    if not args.isdigit():
        proc = Popen(
            f'pip3 -q install tonsdk; python3 -c "from tonsdk.boc import Cell, begin_cell; from base64 import b64decode; from tonsdk.utils import Address; print({args}.to_boc(False).hex())"',
            shell=True, stdout=PIPE, stderr=PIPE
        )
        proc.wait()
        out, err = proc.communicate()
        print(out.decode() or f"Error: {err.decode()}")
        messages = Cell.one_from_boc(bytes.fromhex(out.decode().replace('\n', '')))
        messages = begin_cell().store_cell(messages)
    
    query = multisig.create_transfer_proposal_message(
        [], query_id, messages=messages
    )
    send_boc(query['message'].to_boc(False))
    print(f"Sent proposal message to multisig [{query['query_id']}]")

