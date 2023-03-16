from tonsdk.contract import Contract
from tonsdk.contract.wallet._wallet_contract_v3 import WalletV3ContractBase
from tonsdk.boc import Cell, begin_cell, begin_dict
from tonsdk.utils import Address, sign_message
from nacl.signing import SigningKey

import time
import decimal


class MultisigWalletCV1(WalletV3ContractBase):
    code = 'b5ee9c724102130100035d000114ff00f4a413f4bcf2c80b01020120050201f8f28308d71820d70bff21f901541033f910f2e1918307d721d33ff823aa1f5320b9f261ed44d0d33f01f861d33f01f862fa0001f863f40401f864f40401f865d1f84552308040f40e6fa1208e1c01d431f4043052508307f40e6fa120999531d20030b39130e2915be29131e2f8415240bc01b1f2a822f861f84452400302fa8307f40e6fa1f2a2d307d30f3001a420c20af267820186a0f801c8cb07cb0ff84452508307f443f86401d31f018210a83505c8ba8e3cf84552308040f40e6fa1209232d49402d43001e2029401f4043092316de27fc8ca0040558307f44323c8cc5210f400f84552408040f443f86513f00493135f03e28325a18ae630040f00a2f8458040f4966fa532218e405303b98e3602f86501f862708e2bf8448307f47d6fa5208e1b02d307d30f3001a570b609c8cb07cb0ff84452208307f443f864a49132e201b3e630935f0370e2923031e2b30201480b060201200a0702027409080065adf976a268699f80fc30e99f80fc317d0000fc31fa0200fc327a0200fc32e8fc22a90840207a0737d098c91838707c215dd1c00069ae20f6a268699f80fc30e99f80fc317d0000fc31fa0200fc327a0200fc32e8fc22c0207a0737d0f970c96a7a02187c2190f801d0c00043be64776a268699f80fc30e99f80fc317d0000fc31fa0200fc327a0200fc32e8fc2240202cd100c0157d76d176fdf801b829803a4008646582e5816583e5ffc1044c4b4011d07d0165b564b8fd807c21df48adf186c0d01a2d09520d749c2008e8dd307218407ba94d402fb00e30de830708e2bf8448307f47c6fa5208e1b02d307d30f3001a570b609c8cb07cb0ff84452208307f443f864a49132e201b3e630f8458040f45b30f8650e01f631d31f21820b129f04ba8e4331d3ffd200019af844128307f45b30f8648e2fd30f70c8cb0712cb0ff84441308307f443f864705300748010c8cb05cb02cb07cbff8209312d00fa02cb6ac971fb00e28e2721821081842e3dba9631fa0001f8638e1501821010d1a193ba9b31d4d43001fb04ed54db31e0e2e2f80f0f0030f845f844f842f841c8cb3fcb3ff843fa02f400f400c9ed540201201211005b5708e28018307f4966fa5208e1802d20030f2a3f8448307f40e6fa13078d721d30f3013a002926c21e2b312e631800034308128cee11'

    def __init__(self, **kwargs):
        kwargs['code'] = Cell.one_from_boc(self.code)
        # kwargs['private_key'], kwargs['public_key'] = bytes(32), bytes(32)
        super().__init__(**kwargs)

    def create_data_cell(self):
        owners = begin_dict(256)
        for i, owner in enumerate(self.options['owners']):
            assert len(owner['public_key']) == 32
            owners.store_cell(
                int(owner['public_key'].hex(), 16), begin_cell()
                    .store_uint(0, 8)
                    .store_uint(owner['weight'], 16)
            )
        
        return (
            begin_cell()
                .store_uint(0, 128)
                .store_coins(self.options.get('threshold') or len(self.options['owners']))
                .store_maybe_ref(owners.end_dict())
                .store_uint(0, 1)
                .end_cell()
        )

    def create_transfer_proposal_message(self, recipients_list: list, query_id: int, timeout=60, dummy_signature=False, messages=None):
        if query_id < int(time.time()) << 32:
            query_id = int(time.time() + timeout) << 32 + query_id

        signing_message = self.create_signing_message(query_id)
        signing_message = signing_message.store_uint(0xa83505c8, 32) # submit proposal

        if messages is None:
            messages = begin_cell()
            for i, recipient in enumerate(recipients_list):
                payload_cell = Cell()
                if recipient.get('payload'):
                    if type(recipient['payload']) == str:
                        if len(recipient['payload']) > 0:
                            payload_cell.bits.write_uint(0, 32)
                            payload_cell.bits.write_string(recipient['payload'])
                    elif hasattr(recipient['payload'], 'refs'):
                        payload_cell = recipient['payload']
                    else:
                        payload_cell.bits.write_bytes(recipient['payload'])

                order_header = Contract.create_internal_message_header(
                    Address(recipient['address']), decimal.Decimal(recipient['amount'])
                )
                order = Contract.create_common_msg_info(
                    order_header, recipient.get('state_init'), payload_cell
                )
                
                messages = messages.store_uint8(recipient.get('send_mode', 0))
                messages = messages.store_ref(order)

        signing_message = signing_message.store_ref(messages.end_cell())
        return self.create_external_message(
            signing_message.end_cell(), dummy_signature
        )

    def create_upgrade_proposal_message(self, new_code, new_data, query_id: int = 0):
        if query_id < int(time.time()) << 32:
            query_id = int(time.time() + 60) << 32 + query_id

        signing_message = self.create_signing_message(query_id)
        signing_message = signing_message.store_uint(0xa83505c8, 32) # submit proposal
        signing_message = signing_message.store_uint(255, 8).store_uint(0x10d1a193, 32) # upgrade
        signing_message = signing_message.store_ref(new_code)
        signing_message = signing_message.store_ref(new_data)
        return self.create_external_message(
            signing_message.end_cell(), False
        )

    def create_signing_message(self, query_id: int = 0):
        return begin_cell().store_bytes(
            SigningKey(self.options['private_key']).verify_key._key    
        ).store_uint(query_id, 64)

    def create_external_message(self, signing_message, dummy_signature=False):
        signature = bytes(64) if dummy_signature else SigningKey(self.options['private_key']).sign(bytes(signing_message.bytes_hash()))._signature
        
        body = Cell()
        body.bits.write_bytes(signature)
        body.write_cell(signing_message)

        state_init = code = data = None
        self_address = self.address
        header = Contract.create_external_message_header(self_address)
        result_message = Contract.create_common_msg_info(
            header, state_init, body)

        return {
            "address": self_address,
            "message": result_message,
            "body": body,
            "signature": signature,
            "signing_message": signing_message,
            "state_init": state_init,
            "code": code,
            "data": data,
            "query_id": int(signing_message.bits.array[32:32+8].hex(), 16)
        }

    def create_init_external_message(self, timeout=10):
        create_state_init = self.create_state_init()
        state_init = create_state_init["state_init"]
        address = create_state_init["address"]
        code = create_state_init["code"]
        data = create_state_init["data"]

        signing_message = self.create_signing_message(int(time.time() + timeout) << 32) \
            .store_uint(0xa83505c8, 32).store_ref(
                begin_cell().end_cell()
            ).end_cell()
        
        signature = SigningKey(self.options['private_key']).sign(bytes(signing_message.bytes_hash()))._signature

        body = Cell()
        body.bits.write_bytes(signature)
        body.write_cell(signing_message)

        header = Contract.create_external_message_header(address)
        external_message = Contract.create_common_msg_info(
            header, state_init, body)

        return {
            "address": address,
            "message": external_message,

            "body": body,
            "signing_message": signing_message,
            "state_init": state_init,
            "code": code,
            "data": data,
        }
