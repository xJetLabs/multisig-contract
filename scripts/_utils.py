from base64 import b64encode, b64decode
from nacl.signing import SigningKey
import httpx
import time
import os

TESTNET = False
TONCENTER_API_KEY = None
TONCENTER_ENDPOINT = f"https://{'testnet.' if TESTNET else ''}toncenter.com/api/v2/"


def send_boc(src: bytes):
    res = httpx.post(
        TONCENTER_ENDPOINT + 'sendBoc',
        headers={
            'X-API-Key': TONCENTER_API_KEY,
        } if TONCENTER_API_KEY else {},
        json={
            'boc': b64encode(src).decode(),
        }
    ).json()
    print(res)
    return res

def get_identity():
    try:
        with open('.identity', 'r') as file:
            private_key = SigningKey(bytes.fromhex(file.read()))
            return private_key.verify_key._key, private_key._seed
    except:
        private_key = os.urandom(32)
        with open('.identity', 'w') as file:
            file.write(private_key.hex())
        return get_identity()
