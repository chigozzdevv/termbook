use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction},
    keccak,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar,
};
use solana_system_interface::{instruction as system_instruction, program as system_program};
use std::str::FromStr;

use crate::VaultError;

#[cfg(not(feature = "testnet"))]
const CORE_ID: &str = "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth";
#[cfg(feature = "testnet")]
const CORE_ID: &str = "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5";
const POST_SHIM_ID: &str = "EtZMZM22ViKMo4r5y4Anovs3wKQ2owUmDpjygnMMcdEX";
const POST_MESSAGE_DISCRIMINATOR: [u8; 8] = [214, 50, 100, 209, 38, 34, 7, 76];
const SNAPSHOT_DOMAIN: &[u8] = b"Termbook Solana snapshot v1";
const AUTH_DOMAIN: &[u8] = b"Termbook Monad authorization v1";
#[cfg(not(feature = "testnet"))]
const MONAD_WORMHOLE_CHAIN: u16 = 48;
#[cfg(feature = "testnet")]
const MONAD_WORMHOLE_CHAIN: u16 = 10009;
const FINALIZED: u8 = 1;

#[derive(BorshDeserialize, BorshSerialize)]
struct PostedMessage {
    vaa_version: u8,
    consistency_level: u8,
    vaa_time: u32,
    vaa_signature_account: [u8; 32],
    submission_time: u32,
    nonce: u32,
    sequence: u64,
    emitter_chain: u16,
    emitter_address: [u8; 32],
    payload: Vec<u8>,
}

pub fn verify_monad_authorization(
    posted_vaa: &AccountInfo,
    monad_core: &[u8; 20],
    action_hash: &[u8; 32],
) -> Result<(), ProgramError> {
    if *action_hash == [0; 32] || *monad_core == [0; 20] {
        return Err(VaultError::InvalidAction.into());
    }
    let core = core_id()?;
    if posted_vaa.owner != &core || posted_vaa.data_len() < 3 {
        return Err(VaultError::VerifierUnavailable.into());
    }
    let data = posted_vaa.try_borrow_data()?;
    if &data[..3] != b"vaa" {
        return Err(VaultError::InvalidBinding.into());
    }
    let message =
        PostedMessage::try_from_slice(&data[3..]).map_err(|_| ProgramError::InvalidAccountData)?;
    let mut emitter = [0u8; 32];
    emitter[12..].copy_from_slice(monad_core);
    let mut expected_payload = [0u8; 64];
    expected_payload[..32].copy_from_slice(&keccak::hash(AUTH_DOMAIN).to_bytes());
    expected_payload[32..].copy_from_slice(action_hash);
    if message.vaa_version != 1
        || message.emitter_chain != MONAD_WORMHOLE_CHAIN
        || message.emitter_address != emitter
        || message.consistency_level != 0
        || message.vaa_time == 0
        || message.submission_time == 0
        || message.payload.as_slice() != expected_payload
    {
        return Err(VaultError::InvalidBinding.into());
    }
    let body_hash = keccak::hashv(&[
        &message.vaa_time.to_be_bytes(),
        &message.nonce.to_be_bytes(),
        &message.emitter_chain.to_be_bytes(),
        &message.emitter_address,
        &message.sequence.to_be_bytes(),
        &[message.consistency_level],
        &message.payload,
    ]);
    let (expected, _) = Pubkey::find_program_address(&[b"PostedVAA", body_hash.as_ref()], &core);
    if *posted_vaa.key != expected || message.vaa_signature_account == [0; 32] {
        return Err(VaultError::InvalidBinding.into());
    }
    Ok(())
}

pub fn publish_snapshot<'a>(
    program_id: &Pubkey,
    account: &AccountInfo<'a>,
    accounts: &[AccountInfo<'a>],
) -> Result<(), ProgramError> {
    if account.owner != program_id || accounts.len() != 11 {
        return Err(VaultError::InvalidBinding.into());
    }
    let payer = &accounts[0];
    let bridge = &accounts[1];
    let message = &accounts[2];
    let emitter = &accounts[3];
    let sequence = &accounts[4];
    let fee_collector = &accounts[5];
    let clock = &accounts[6];
    let system = &accounts[7];
    let core_program = &accounts[8];
    let event_authority = &accounts[9];
    let shim_program = &accounts[10];
    let core = core_id()?;
    let shim = post_shim_id()?;
    let (expected_emitter, bump) = Pubkey::find_program_address(&[b"emitter"], program_id);
    let (expected_bridge, _) = Pubkey::find_program_address(&[b"Bridge"], &core);
    let (expected_sequence, _) =
        Pubkey::find_program_address(&[b"Sequence", emitter.key.as_ref()], &core);
    let (expected_collector, _) = Pubkey::find_program_address(&[b"fee_collector"], &core);
    let (expected_message, _) = Pubkey::find_program_address(&[emitter.key.as_ref()], &shim);
    let (expected_authority, _) = Pubkey::find_program_address(&[b"__event_authority"], &shim);
    if !payer.is_signer
        || !payer.is_writable
        || !bridge.is_writable
        || !message.is_writable
        || !sequence.is_writable
        || !fee_collector.is_writable
        || *emitter.key != expected_emitter
        || *bridge.key != expected_bridge
        || *sequence.key != expected_sequence
        || *fee_collector.key != expected_collector
        || *message.key != expected_message
        || *event_authority.key != expected_authority
        || *clock.key != sysvar::clock::id()
        || *system.key != system_program::id()
        || *core_program.key != core
        || *shim_program.key != shim
        || bridge.owner != &core
        || !core_program.executable
        || !shim_program.executable
    {
        return Err(VaultError::InvalidBinding.into());
    }
    let bridge_data = bridge.try_borrow_data()?;
    if bridge_data.len() != 24 {
        return Err(VaultError::InvalidBinding.into());
    }
    let fee = u64::from_le_bytes(
        bridge_data[16..24]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    );
    drop(bridge_data);
    if fee > 0 {
        invoke(
            &system_instruction::transfer(payer.key, fee_collector.key, fee),
            &[payer.clone(), fee_collector.clone(), system.clone()],
        )?;
    }
    let account_data = account.try_borrow_data()?;
    let mut payload = Vec::with_capacity(76 + account_data.len());
    payload.extend_from_slice(&keccak::hash(SNAPSHOT_DOMAIN).to_bytes());
    payload.extend_from_slice(account.key.as_ref());
    payload.extend_from_slice(&account.lamports().to_le_bytes());
    payload.extend_from_slice(&(account_data.len() as u32).to_le_bytes());
    payload.extend_from_slice(&account_data);
    drop(account_data);
    let mut data = Vec::with_capacity(17 + payload.len());
    data.extend_from_slice(&POST_MESSAGE_DISCRIMINATOR);
    data.extend_from_slice(&0u32.to_le_bytes());
    data.push(FINALIZED);
    data.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    data.extend_from_slice(&payload);
    let instruction = Instruction {
        program_id: shim,
        accounts: vec![
            AccountMeta::new(*bridge.key, false),
            AccountMeta::new(*message.key, false),
            AccountMeta::new_readonly(*emitter.key, true),
            AccountMeta::new(*sequence.key, false),
            AccountMeta::new(*payer.key, true),
            AccountMeta::new(*fee_collector.key, false),
            AccountMeta::new_readonly(*clock.key, false),
            AccountMeta::new_readonly(*system.key, false),
            AccountMeta::new_readonly(*core_program.key, false),
            AccountMeta::new_readonly(*event_authority.key, false),
            AccountMeta::new_readonly(*shim_program.key, false),
        ],
        data,
    };
    invoke_signed(
        &instruction,
        &[
            bridge.clone(),
            message.clone(),
            emitter.clone(),
            sequence.clone(),
            payer.clone(),
            fee_collector.clone(),
            clock.clone(),
            system.clone(),
            core_program.clone(),
            event_authority.clone(),
            shim_program.clone(),
        ],
        &[&[b"emitter", &[bump]]],
    )
}

fn core_id() -> Result<Pubkey, ProgramError> {
    Pubkey::from_str(CORE_ID).map_err(|_| ProgramError::InvalidArgument)
}

fn post_shim_id() -> Result<Pubkey, ProgramError> {
    Pubkey::from_str(POST_SHIM_ID).map_err(|_| ProgramError::InvalidArgument)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn posted_message(core_address: [u8; 20], action_hash: [u8; 32]) -> (Pubkey, Vec<u8>) {
        let mut emitter = [0u8; 32];
        emitter[12..].copy_from_slice(&core_address);
        let mut payload = Vec::with_capacity(64);
        payload.extend_from_slice(&keccak::hash(AUTH_DOMAIN).to_bytes());
        payload.extend_from_slice(&action_hash);
        let message = PostedMessage {
            vaa_version: 1,
            consistency_level: 0,
            vaa_time: 100,
            vaa_signature_account: [7; 32],
            submission_time: 101,
            nonce: 0,
            sequence: 1,
            emitter_chain: MONAD_WORMHOLE_CHAIN,
            emitter_address: emitter,
            payload,
        };
        let body_hash = keccak::hashv(&[
            &message.vaa_time.to_be_bytes(),
            &message.nonce.to_be_bytes(),
            &message.emitter_chain.to_be_bytes(),
            &message.emitter_address,
            &message.sequence.to_be_bytes(),
            &[message.consistency_level],
            &message.payload,
        ]);
        let (key, _) =
            Pubkey::find_program_address(&[b"PostedVAA", body_hash.as_ref()], &core_id().unwrap());
        let mut data = b"vaa".to_vec();
        data.extend_from_slice(&borsh::to_vec(&message).unwrap());
        (key, data)
    }

    #[test]
    fn validates_posted_vaa_account_and_exact_authorization() {
        let core = core_id().unwrap();
        let monad_core = [3; 20];
        let action_hash = [4; 32];
        let (key, mut data) = posted_message(monad_core, action_hash);
        let mut lamports = 1;
        let account = AccountInfo::new(&key, false, false, &mut lamports, &mut data, &core, false);
        assert_eq!(
            verify_monad_authorization(&account, &monad_core, &action_hash),
            Ok(())
        );
        assert!(verify_monad_authorization(&account, &[5; 20], &action_hash).is_err());
        assert!(verify_monad_authorization(&account, &monad_core, &[5; 32]).is_err());
    }

    #[test]
    fn rejects_unverified_account_or_modified_body() {
        let core = core_id().unwrap();
        let monad_core = [3; 20];
        let action_hash = [4; 32];
        let (key, mut data) = posted_message(monad_core, action_hash);
        let mut lamports = 1;
        let wrong_owner = Pubkey::new_unique();
        let account = AccountInfo::new(
            &key,
            false,
            false,
            &mut lamports,
            &mut data,
            &wrong_owner,
            false,
        );
        assert!(verify_monad_authorization(&account, &monad_core, &action_hash).is_err());
        drop(account);
        data[45] ^= 1;
        let account = AccountInfo::new(&key, false, false, &mut lamports, &mut data, &core, false);
        assert!(verify_monad_authorization(&account, &monad_core, &action_hash).is_err());
    }
}
