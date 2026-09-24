use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    keccak,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};
use solana_system_interface::{instruction as system_instruction, program as system_program};

mod wormhole;

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

const LOCK_SEED: &[u8] = b"termbook-lock";
const RECOVERY_SEED: &[u8] = b"termbook-recovery";
const LOCK_VERSION: u8 = 3;
const RECOVERY_VERSION: u8 = 3;
pub const NATIVE_SOL_ASSET_ID: [u8; 32] = [1; 32];

#[repr(u32)]
pub enum VaultError {
    InvalidBinding = 1,
    Expired = 2,
    VerifierUnavailable = 3,
    Replay = 4,
    InvalidAction = 5,
}

impl From<VaultError> for ProgramError {
    fn from(value: VaultError) -> Self {
        ProgramError::Custom(value as u32)
    }
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum VaultInstruction {
    Lock(LockRequest),
    Apply(ApplyRequest),
    Expire(ApplyRequest),
    RecoveryPayout(RecoveryPayoutRequest),
    FundRecovery(RecoveryFundingRequest),
    ReconcileRecoveryRefund(RecoveryRefundRequest),
    CheckpointRecovery(RecoveryCheckpointRequest),
    CheckpointLock,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RecoveryRefundRequest {
    pub amount_lamports: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RecoveryCheckpointRequest {
    pub deadline: i64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ApplyRequest {
    pub authorization: RemoteAuthorization,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RecoveryPayoutRequest {
    pub recipient: [u8; 32],
    pub amount_lamports: u64,
    pub nonce: u64,
    pub revision: u64,
    pub deadline: i64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RecoveryFundingRequest {
    pub operation_id: [u8; 32],
    pub operation_digest: [u8; 32],
    pub inbox: [u8; 20],
    pub deposit_pubkey: [u8; 32],
    pub amount_lamports: u64,
    pub quote_hash: [u8; 32],
    pub nonce: u64,
    pub revision: u64,
    pub deadline: i64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct LockRequest {
    pub lock_id: [u8; 32],
    pub credit_id: [u8; 32],
    pub monad_chain: u64,
    pub monad_core: [u8; 20],
    pub monad_borrower: [u8; 20],
    pub source_genesis: [u8; 32],
    pub return_recipient: [u8; 32],
    pub recovery_vault: [u8; 32],
    pub terms_hash: [u8; 32],
    pub amount_lamports: u64,
    pub setup_deadline: i64,
    pub verifier_version: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct LockRecord {
    pub version: u8,
    pub bump: u8,
    pub lock_id: [u8; 32],
    pub credit_id: [u8; 32],
    pub owner: [u8; 32],
    pub monad_chain: u64,
    pub monad_core: [u8; 20],
    pub monad_borrower: [u8; 20],
    pub source_genesis: [u8; 32],
    pub source_program: [u8; 32],
    pub source_vault: [u8; 32],
    pub asset: [u8; 32],
    pub return_recipient: [u8; 32],
    pub recovery_vault: [u8; 32],
    pub terms_hash: [u8; 32],
    pub initial_amount: u64,
    pub remaining_amount: u64,
    pub setup_deadline: i64,
    pub verifier_version: u64,
    pub last_nonce: u64,
    pub last_revision: u64,
    pub last_action_hash: [u8; 32],
    pub last_canceled_nonce: u64,
    pub last_canceled_action_hash: [u8; 32],
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RecoveryRecord {
    pub version: u8,
    pub bump: u8,
    pub credit_id: [u8; 32],
    pub lock_id: [u8; 32],
    pub owner: [u8; 32],
    pub source_vault: [u8; 32],
    pub held_lamports: u64,
    pub last_seizure_hash: [u8; 32],
    pub last_payout_nonce: u64,
    pub last_payout_revision: u64,
    pub last_payout_hash: [u8; 32],
    pub funded_lamports: u64,
    pub last_funding_nonce: u64,
    pub last_funding_revision: u64,
    pub last_funding_hash: [u8; 32],
    pub refunded_lamports: u64,
}

struct AccountRent {
    lock: u64,
    recovery: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RemoteAuthorization {
    pub monad_chain: u64,
    pub monad_core: [u8; 20],
    pub source_genesis: [u8; 32],
    pub source_vault: [u8; 32],
    pub credit_id: [u8; 32],
    pub lock_id: [u8; 32],
    pub asset: [u8; 32],
    pub kind: u8,
    pub recipient: [u8; 32],
    pub amount_lamports: u64,
    pub nonce: u64,
    pub revision: u64,
    pub deadline: i64,
    pub verifier_version: u64,
}

pub const RELEASE: u8 = 0;
pub const SEIZE: u8 = 1;

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = VaultInstruction::try_from_slice(instruction_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    match instruction {
        VaultInstruction::Lock(request) => process_lock(program_id, accounts, &request),
        VaultInstruction::Apply(request) => process_action(program_id, accounts, &request),
        VaultInstruction::Expire(request) => process_expire(program_id, accounts, &request),
        VaultInstruction::RecoveryPayout(request) => {
            process_recovery_payout(program_id, accounts, &request)
        }
        VaultInstruction::FundRecovery(request) => {
            process_recovery_funding(program_id, accounts, &request)
        }
        VaultInstruction::ReconcileRecoveryRefund(request) => {
            process_reconcile_recovery_refund(program_id, accounts, &request)
        }
        VaultInstruction::CheckpointRecovery(request) => {
            process_checkpoint_recovery(program_id, accounts, &request)
        }
        VaultInstruction::CheckpointLock => process_checkpoint_lock(program_id, accounts),
    }
}

fn process_lock(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    request: &LockRequest,
) -> ProgramResult {
    let mut accounts = accounts.iter();
    let owner = next_account_info(&mut accounts)?;
    let lock = next_account_info(&mut accounts)?;
    let recovery = next_account_info(&mut accounts)?;
    let system = next_account_info(&mut accounts)?;
    let posted_vaa = next_account_info(&mut accounts)?;
    let program = next_account_info(&mut accounts)?;
    let program_data = next_account_info(&mut accounts)?;
    let now = Clock::get()?.unix_timestamp;
    validate_lock(request, owner.key, now)?;
    if !owner.is_signer
        || !owner.is_writable
        || !lock.is_writable
        || !recovery.is_writable
        || *system.key != system_program::id()
    {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (expected, bump) = Pubkey::find_program_address(&[LOCK_SEED, &request.lock_id], program_id);
    let (expected_recovery, recovery_bump) = recovery_address(program_id, &request.credit_id);
    if *lock.key != expected
        || *recovery.key != expected_recovery
        || request.recovery_vault != expected_recovery.to_bytes()
        || lock.key == recovery.key
        || request.return_recipient == expected_recovery.to_bytes()
        || request.return_recipient == expected.to_bytes()
        || request.recovery_vault == expected.to_bytes()
    {
        return Err(VaultError::InvalidBinding.into());
    }
    let record = LockRecord {
        version: LOCK_VERSION,
        bump,
        lock_id: request.lock_id,
        credit_id: request.credit_id,
        owner: owner.key.to_bytes(),
        monad_chain: request.monad_chain,
        monad_core: request.monad_core,
        monad_borrower: request.monad_borrower,
        source_genesis: request.source_genesis,
        source_program: program_id.to_bytes(),
        source_vault: lock.key.to_bytes(),
        asset: NATIVE_SOL_ASSET_ID,
        return_recipient: request.return_recipient,
        recovery_vault: request.recovery_vault,
        terms_hash: request.terms_hash,
        initial_amount: request.amount_lamports,
        remaining_amount: request.amount_lamports,
        setup_deadline: request.setup_deadline,
        verifier_version: request.verifier_version,
        last_nonce: 0,
        last_revision: 0,
        last_action_hash: [0; 32],
        last_canceled_nonce: 0,
        last_canceled_action_hash: [0; 32],
    };
    let serialized = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    wormhole::verify_monad_authorization(
        posted_vaa,
        &record.monad_core,
        &solana_lock_digest(&record)?,
    )?;
    verify_immutable_program(program_id, program, program_data)?;
    let recovery_record = RecoveryRecord {
        version: RECOVERY_VERSION,
        bump: recovery_bump,
        credit_id: request.credit_id,
        lock_id: request.lock_id,
        owner: owner.key.to_bytes(),
        source_vault: lock.key.to_bytes(),
        held_lamports: 0,
        last_seizure_hash: [0; 32],
        last_payout_nonce: 0,
        last_payout_revision: 0,
        last_payout_hash: [0; 32],
        funded_lamports: 0,
        last_funding_nonce: 0,
        last_funding_revision: 0,
        last_funding_hash: [0; 32],
        refunded_lamports: 0,
    };
    let serialized_recovery =
        borsh::to_vec(&recovery_record).map_err(|_| ProgramError::InvalidAccountData)?;
    let rent = Rent::get()?.minimum_balance(serialized.len());
    let deposit = rent
        .checked_add(request.amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let bump_seed = [bump];
    create_pda_account(
        owner,
        lock,
        system,
        program_id,
        deposit,
        serialized.len(),
        &[LOCK_SEED, &request.lock_id, &bump_seed],
    )?;
    let recovery_bump_seed = [recovery_bump];
    create_pda_account(
        owner,
        recovery,
        system,
        program_id,
        Rent::get()?.minimum_balance(serialized_recovery.len()),
        serialized_recovery.len(),
        &[RECOVERY_SEED, &request.credit_id, &recovery_bump_seed],
    )?;
    lock.data.borrow_mut().copy_from_slice(&serialized);
    recovery
        .data
        .borrow_mut()
        .copy_from_slice(&serialized_recovery);
    wormhole::publish_snapshot(program_id, lock, accounts.as_slice())?;
    Ok(())
}

fn verify_immutable_program(
    program_id: &Pubkey,
    program: &AccountInfo,
    program_data: &AccountInfo,
) -> ProgramResult {
    let loader = "BPFLoaderUpgradeab1e11111111111111111111111"
        .parse::<Pubkey>()
        .map_err(|_| ProgramError::InvalidArgument)?;
    if program.key != program_id
        || !program.executable
        || program.owner != &loader
        || program_data.owner != &loader
    {
        return Err(VaultError::InvalidBinding.into());
    }
    let program_bytes = program.try_borrow_data()?;
    let data_bytes = program_data.try_borrow_data()?;
    if program_bytes.len() != 36
        || data_bytes.len() < 45
        || program_bytes[..4] != 2u32.to_le_bytes()
        || data_bytes[..4] != 3u32.to_le_bytes()
        || program_bytes[4..36] != program_data.key.as_ref()[..]
        || data_bytes[12] != 0
    {
        return Err(VaultError::InvalidBinding.into());
    }
    Ok(())
}

fn recovery_address(program_id: &Pubkey, credit_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[RECOVERY_SEED, credit_id], program_id)
}

fn create_pda_account<'a>(
    payer: &AccountInfo<'a>,
    account: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    program_id: &Pubkey,
    lamports: u64,
    space: usize,
    seeds: &[&[u8]],
) -> ProgramResult {
    if account.owner != &system_program::id() || !account.data_is_empty() {
        return Err(VaultError::InvalidBinding.into());
    }
    if account.lamports() == 0 {
        invoke_signed(
            &system_instruction::create_account(
                payer.key,
                account.key,
                lamports,
                space as u64,
                program_id,
            ),
            &[payer.clone(), account.clone(), system.clone()],
            &[seeds],
        )?;
    } else {
        if account.lamports() < lamports {
            invoke(
                &system_instruction::transfer(
                    payer.key,
                    account.key,
                    lamports - account.lamports(),
                ),
                &[payer.clone(), account.clone(), system.clone()],
            )?;
        }
        invoke_signed(
            &system_instruction::allocate(account.key, space as u64),
            &[account.clone(), system.clone()],
            &[seeds],
        )?;
        invoke_signed(
            &system_instruction::assign(account.key, program_id),
            &[account.clone(), system.clone()],
            &[seeds],
        )?;
    }
    Ok(())
}

fn process_action(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    request: &ApplyRequest,
) -> ProgramResult {
    let mut accounts = accounts.iter();
    let lock = next_account_info(&mut accounts)?;
    let destination = next_account_info(&mut accounts)?;
    let posted_vaa = next_account_info(&mut accounts)?;
    if !lock.is_writable || !destination.is_writable {
        return Err(VaultError::InvalidBinding.into());
    }
    let record = load_lock(program_id, lock)?;
    let now = Clock::get()?.unix_timestamp;
    validate_action(&record, &request.authorization, destination.key, now)?;
    let action_hash = solana_action_hash(&record, &request.authorization)?;
    wormhole::verify_monad_authorization(posted_vaa, &record.monad_core, &action_hash)?;
    let rent = Rent::get()?;
    apply_verified_action(
        program_id,
        lock,
        destination,
        record,
        &request.authorization,
        now,
        AccountRent {
            lock: rent.minimum_balance(lock.data_len()),
            recovery: rent.minimum_balance(destination.data_len()),
        },
    )?;
    wormhole::publish_snapshot(program_id, lock, accounts.as_slice())
}

fn load_lock(program_id: &Pubkey, lock: &AccountInfo) -> Result<LockRecord, ProgramError> {
    if lock.owner != program_id {
        return Err(VaultError::InvalidBinding.into());
    }
    let record = LockRecord::try_from_slice(&lock.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if record.version != LOCK_VERSION
        || record.source_vault != lock.key.to_bytes()
        || record.source_program != program_id.to_bytes()
    {
        return Err(VaultError::InvalidBinding.into());
    }
    let (expected, bump) = Pubkey::find_program_address(&[LOCK_SEED, &record.lock_id], program_id);
    if *lock.key != expected || record.bump != bump {
        return Err(VaultError::InvalidBinding.into());
    }
    Ok(record)
}

fn process_expire(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    request: &ApplyRequest,
) -> ProgramResult {
    let mut accounts = accounts.iter();
    let lock = next_account_info(&mut accounts)?;
    let posted_vaa = next_account_info(&mut accounts)?;
    if !lock.is_writable {
        return Err(VaultError::InvalidBinding.into());
    }
    let record = load_lock(program_id, lock)?;
    let now = Clock::get()?.unix_timestamp;
    validate_expiration(&record, &request.authorization, now)?;
    let action_hash = solana_action_hash(&record, &request.authorization)?;
    wormhole::verify_monad_authorization(posted_vaa, &record.monad_core, &action_hash)?;
    expire_verified_action(lock, record, &request.authorization, now)?;
    wormhole::publish_snapshot(program_id, lock, accounts.as_slice())
}

fn process_recovery_payout(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    request: &RecoveryPayoutRequest,
) -> ProgramResult {
    let mut accounts = accounts.iter();
    let lock = next_account_info(&mut accounts)?;
    let recovery = next_account_info(&mut accounts)?;
    let destination = next_account_info(&mut accounts)?;
    let posted_vaa = next_account_info(&mut accounts)?;
    if !lock.is_writable
        || !recovery.is_writable
        || !destination.is_writable
        || recovery.key == destination.key
        || lock.key == destination.key
    {
        return Err(VaultError::InvalidBinding.into());
    }
    let lock_record = load_lock(program_id, lock)?;
    let now = Clock::get()?.unix_timestamp;
    let rent_reserve = Rent::get()?.minimum_balance(recovery.data_len());
    let recovery_record = load_recovery(program_id, recovery, &lock_record, rent_reserve)?;
    validate_recovery_payout(
        &lock_record,
        &recovery_record,
        request,
        destination.key,
        now,
    )?;
    let payout_hash = solana_recovery_payout_hash(&lock_record, request)?;
    wormhole::verify_monad_authorization(posted_vaa, &lock_record.monad_core, &payout_hash)?;
    apply_verified_recovery_payout(
        lock,
        lock_record,
        recovery,
        destination,
        recovery_record,
        request,
        payout_hash,
    )?;
    wormhole::publish_snapshot(program_id, recovery, accounts.as_slice())
}

fn process_recovery_funding(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    request: &RecoveryFundingRequest,
) -> ProgramResult {
    let mut accounts = accounts.iter();
    let lock = next_account_info(&mut accounts)?;
    let recovery = next_account_info(&mut accounts)?;
    let destination = next_account_info(&mut accounts)?;
    let posted_vaa = next_account_info(&mut accounts)?;
    if !lock.is_writable
        || !recovery.is_writable
        || !destination.is_writable
        || recovery.key == destination.key
        || lock.key == destination.key
    {
        return Err(VaultError::InvalidBinding.into());
    }
    let lock_record = load_lock(program_id, lock)?;
    let now = Clock::get()?.unix_timestamp;
    let rent_reserve = Rent::get()?.minimum_balance(recovery.data_len());
    let recovery_record = load_recovery(program_id, recovery, &lock_record, rent_reserve)?;
    validate_recovery_funding(
        &lock_record,
        &recovery_record,
        request,
        destination.key,
        now,
    )?;
    let funding_hash = solana_recovery_funding_hash(&lock_record, request)?;
    wormhole::verify_monad_authorization(posted_vaa, &lock_record.monad_core, &funding_hash)?;
    apply_verified_recovery_funding(
        lock,
        lock_record,
        recovery,
        destination,
        recovery_record,
        request,
        funding_hash,
    )?;
    wormhole::publish_snapshot(program_id, recovery, accounts.as_slice())
}

fn process_reconcile_recovery_refund(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    request: &RecoveryRefundRequest,
) -> ProgramResult {
    let mut accounts = accounts.iter();
    let lock = next_account_info(&mut accounts)?;
    let recovery = next_account_info(&mut accounts)?;
    if !recovery.is_writable {
        return Err(VaultError::InvalidBinding.into());
    }
    let lock_record = load_lock(program_id, lock)?;
    let rent_reserve = Rent::get()?.minimum_balance(recovery.data_len());
    let recovery_record = load_recovery(program_id, recovery, &lock_record, rent_reserve)?;
    reconcile_recovery_refund(
        recovery,
        recovery_record,
        request.amount_lamports,
        rent_reserve,
    )?;
    wormhole::publish_snapshot(program_id, recovery, accounts.as_slice())
}

fn process_checkpoint_recovery(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    request: &RecoveryCheckpointRequest,
) -> ProgramResult {
    let mut accounts = accounts.iter();
    let lock = next_account_info(&mut accounts)?;
    let recovery = next_account_info(&mut accounts)?;
    let lock_record = load_lock(program_id, lock)?;
    let rent_reserve = Rent::get()?.minimum_balance(recovery.data_len());
    load_recovery(program_id, recovery, &lock_record, rent_reserve)?;
    if request.deadline <= 0 || Clock::get()?.unix_timestamp <= request.deadline {
        return Err(VaultError::Expired.into());
    }
    wormhole::publish_snapshot(program_id, recovery, accounts.as_slice())
}

fn process_checkpoint_lock(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let mut accounts = accounts.iter();
    let lock = next_account_info(&mut accounts)?;
    load_lock(program_id, lock)?;
    wormhole::publish_snapshot(program_id, lock, accounts.as_slice())
}

fn reconcile_recovery_refund(
    recovery: &AccountInfo,
    mut record: RecoveryRecord,
    amount_lamports: u64,
    rent_reserve: u64,
) -> ProgramResult {
    let unreconciled = record
        .funded_lamports
        .checked_sub(record.refunded_lamports)
        .ok_or(VaultError::InvalidBinding)?;
    let reserved = rent_reserve
        .checked_add(record.held_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let excess = recovery
        .lamports()
        .checked_sub(reserved)
        .ok_or(VaultError::InvalidBinding)?;
    if amount_lamports == 0 || amount_lamports > unreconciled || amount_lamports > excess {
        return Err(VaultError::InvalidAction.into());
    }
    record.held_lamports = record
        .held_lamports
        .checked_add(amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    record.refunded_lamports = record
        .refunded_lamports
        .checked_add(amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let serialized = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    if serialized.len() != recovery.data_len() {
        return Err(ProgramError::InvalidAccountData);
    }
    recovery.try_borrow_mut_data()?.copy_from_slice(&serialized);
    Ok(())
}

fn validate_recovery_funding(
    lock: &LockRecord,
    recovery: &RecoveryRecord,
    request: &RecoveryFundingRequest,
    destination: &Pubkey,
    now: i64,
) -> ProgramResult {
    if request.operation_id == [0; 32]
        || request.operation_digest == [0; 32]
        || request.inbox == [0; 20]
        || request.deposit_pubkey == [0; 32]
        || request.quote_hash == [0; 32]
        || request.deposit_pubkey != destination.to_bytes()
        || request.deposit_pubkey == lock.return_recipient
        || request.deposit_pubkey == lock.source_vault
        || request.deposit_pubkey == lock.recovery_vault
        || request.amount_lamports == 0
        || request.amount_lamports > recovery.held_lamports
        || recovery.last_seizure_hash == [0; 32]
    {
        return Err(VaultError::InvalidAction.into());
    }
    if request.nonce == 0
        || request.nonce <= recovery.last_funding_nonce
        || request.nonce <= recovery.last_payout_nonce
        || request.revision == 0
        || request.revision <= lock.last_revision
        || request.revision <= recovery.last_funding_revision
        || request.revision <= recovery.last_payout_revision
    {
        return Err(VaultError::Replay.into());
    }
    if request.deadline <= 0 || now > request.deadline {
        return Err(VaultError::Expired.into());
    }
    Ok(())
}

fn apply_verified_recovery_funding(
    lock: &AccountInfo,
    mut lock_record: LockRecord,
    recovery: &AccountInfo,
    destination: &AccountInfo,
    mut record: RecoveryRecord,
    request: &RecoveryFundingRequest,
    funding_hash: [u8; 32],
) -> ProgramResult {
    record.held_lamports = record
        .held_lamports
        .checked_sub(request.amount_lamports)
        .ok_or(VaultError::InvalidAction)?;
    record.funded_lamports = record
        .funded_lamports
        .checked_add(request.amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    record.last_funding_nonce = request.nonce;
    record.last_funding_revision = request.revision;
    record.last_funding_hash = funding_hash;
    lock_record.last_revision = request.revision;
    commit_recovery_transfer(
        lock,
        lock_record,
        recovery,
        destination,
        record,
        request.amount_lamports,
    )
}

fn validate_recovery_payout(
    lock: &LockRecord,
    recovery: &RecoveryRecord,
    request: &RecoveryPayoutRequest,
    destination: &Pubkey,
    now: i64,
) -> ProgramResult {
    if request.recipient != lock.return_recipient
        || request.recipient != destination.to_bytes()
        || request.amount_lamports == 0
        || request.amount_lamports > recovery.held_lamports
        || recovery.last_seizure_hash == [0; 32]
    {
        return Err(VaultError::InvalidAction.into());
    }
    if request.nonce == 0
        || request.nonce <= recovery.last_payout_nonce
        || request.nonce <= recovery.last_funding_nonce
        || request.revision == 0
        || request.revision <= lock.last_revision
        || request.revision <= recovery.last_payout_revision
        || request.revision <= recovery.last_funding_revision
    {
        return Err(VaultError::Replay.into());
    }
    if request.deadline <= 0 || now > request.deadline {
        return Err(VaultError::Expired.into());
    }
    Ok(())
}

fn apply_verified_recovery_payout(
    lock: &AccountInfo,
    mut lock_record: LockRecord,
    recovery: &AccountInfo,
    destination: &AccountInfo,
    mut record: RecoveryRecord,
    request: &RecoveryPayoutRequest,
    payout_hash: [u8; 32],
) -> ProgramResult {
    record.held_lamports = record
        .held_lamports
        .checked_sub(request.amount_lamports)
        .ok_or(VaultError::InvalidAction)?;
    record.last_payout_nonce = request.nonce;
    record.last_payout_revision = request.revision;
    record.last_payout_hash = payout_hash;
    lock_record.last_revision = request.revision;
    commit_recovery_transfer(
        lock,
        lock_record,
        recovery,
        destination,
        record,
        request.amount_lamports,
    )
}

fn commit_recovery_transfer(
    lock: &AccountInfo,
    lock_record: LockRecord,
    recovery: &AccountInfo,
    destination: &AccountInfo,
    record: RecoveryRecord,
    amount_lamports: u64,
) -> ProgramResult {
    let recovery_balance = recovery.lamports();
    let destination_balance = destination
        .lamports()
        .checked_add(amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let serialized = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    let serialized_lock =
        borsh::to_vec(&lock_record).map_err(|_| ProgramError::InvalidAccountData)?;
    if serialized.len() != recovery.data_len() || serialized_lock.len() != lock.data_len() {
        return Err(ProgramError::InvalidAccountData);
    }
    let remaining_balance = recovery_balance
        .checked_sub(amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let mut recovery_data = recovery.try_borrow_mut_data()?;
    let mut lock_data = lock.try_borrow_mut_data()?;
    let mut recovery_lamports = recovery.try_borrow_mut_lamports()?;
    let mut destination_lamports = destination.try_borrow_mut_lamports()?;
    recovery_data.copy_from_slice(&serialized);
    lock_data.copy_from_slice(&serialized_lock);
    **recovery_lamports = remaining_balance;
    **destination_lamports = destination_balance;
    Ok(())
}

fn validate_expiration(lock: &LockRecord, action: &RemoteAuthorization, now: i64) -> ProgramResult {
    validate_action(
        lock,
        action,
        &Pubkey::new_from_array(action.recipient),
        action.deadline,
    )?;
    if now <= action.deadline {
        return Err(VaultError::InvalidAction.into());
    }
    Ok(())
}

fn expire_verified_action(
    lock: &AccountInfo,
    mut record: LockRecord,
    action: &RemoteAuthorization,
    now: i64,
) -> ProgramResult {
    if !lock.is_writable {
        return Err(VaultError::InvalidBinding.into());
    }
    validate_expiration(&record, action, now)?;
    let action_hash = solana_action_hash(&record, action)?;
    record.last_nonce = action.nonce;
    record.last_revision = action.revision;
    record.last_canceled_nonce = action.nonce;
    record.last_canceled_action_hash = action_hash;
    let serialized = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    if serialized.len() != lock.data_len() {
        return Err(ProgramError::InvalidAccountData);
    }
    lock.try_borrow_mut_data()?.copy_from_slice(&serialized);
    Ok(())
}

fn apply_verified_action(
    program_id: &Pubkey,
    lock: &AccountInfo,
    destination: &AccountInfo,
    mut record: LockRecord,
    action: &RemoteAuthorization,
    now: i64,
    rent: AccountRent,
) -> ProgramResult {
    if lock.key == destination.key || !lock.is_writable || !destination.is_writable {
        return Err(VaultError::InvalidBinding.into());
    }
    validate_action(&record, action, destination.key, now)?;
    let balance = lock.lamports();
    let required = rent
        .lock
        .checked_add(record.remaining_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if balance < required {
        return Err(VaultError::InvalidBinding.into());
    }
    let destination_balance = destination
        .lamports()
        .checked_add(action.amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let action_hash = solana_action_hash(&record, action)?;
    let recovery_update = if action.kind == SEIZE {
        Some(prepare_recovery_update(
            program_id,
            destination,
            &record,
            action.amount_lamports,
            action_hash,
            rent.recovery,
        )?)
    } else {
        None
    };
    record.remaining_amount = record
        .remaining_amount
        .checked_sub(action.amount_lamports)
        .ok_or(VaultError::InvalidAction)?;
    record.last_nonce = action.nonce;
    record.last_revision = action.revision;
    record.last_action_hash = action_hash;
    let serialized = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    if serialized.len() != lock.data_len() {
        return Err(ProgramError::InvalidAccountData);
    }
    let remaining_balance = balance
        .checked_sub(action.amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let mut lock_data = lock.try_borrow_mut_data()?;
    let mut recovery_data = if recovery_update.is_some() {
        Some(destination.try_borrow_mut_data()?)
    } else {
        None
    };
    let mut lock_lamports = lock.try_borrow_mut_lamports()?;
    let mut destination_lamports = destination.try_borrow_mut_lamports()?;
    lock_data.copy_from_slice(&serialized);
    if let (Some(updated), Some(data)) = (recovery_update, recovery_data.as_mut()) {
        data.copy_from_slice(&updated);
    }
    **lock_lamports = remaining_balance;
    **destination_lamports = destination_balance;
    Ok(())
}

fn prepare_recovery_update(
    program_id: &Pubkey,
    destination: &AccountInfo,
    lock: &LockRecord,
    amount_lamports: u64,
    action_hash: [u8; 32],
    rent_reserve: u64,
) -> Result<Vec<u8>, ProgramError> {
    let mut record = load_recovery(program_id, destination, lock, rent_reserve)?;
    record.held_lamports = record
        .held_lamports
        .checked_add(amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    record.last_seizure_hash = action_hash;
    let updated = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    if updated.len() != destination.data_len() {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(updated)
}

fn load_recovery(
    program_id: &Pubkey,
    recovery: &AccountInfo,
    lock: &LockRecord,
    rent_reserve: u64,
) -> Result<RecoveryRecord, ProgramError> {
    let (expected, bump) = recovery_address(program_id, &lock.credit_id);
    if recovery.key != &expected
        || recovery.owner != program_id
        || lock.recovery_vault != expected.to_bytes()
    {
        return Err(VaultError::InvalidBinding.into());
    }
    let record = RecoveryRecord::try_from_slice(&recovery.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if record.version != RECOVERY_VERSION
        || record.bump != bump
        || record.credit_id != lock.credit_id
        || record.lock_id != lock.lock_id
        || record.owner != lock.owner
        || record.source_vault != lock.source_vault
    {
        return Err(VaultError::InvalidBinding.into());
    }
    let required = rent_reserve
        .checked_add(record.held_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if recovery.lamports() < required {
        return Err(VaultError::InvalidBinding.into());
    }
    Ok(record)
}

pub fn validate_lock(request: &LockRequest, owner: &Pubkey, now: i64) -> ProgramResult {
    if request.lock_id == [0; 32]
        || request.credit_id == [0; 32]
        || request.monad_chain == 0
        || request.monad_core == [0; 20]
        || request.monad_borrower == [0; 20]
        || request.source_genesis == [0; 32]
        || request.return_recipient == [0; 32]
        || request.recovery_vault == [0; 32]
        || request.terms_hash == [0; 32]
        || request.amount_lamports == 0
        || request.verifier_version == 0
        || *owner == Pubkey::default()
    {
        return Err(VaultError::InvalidBinding.into());
    }
    if now > request.setup_deadline {
        return Err(VaultError::Expired.into());
    }
    Ok(())
}

pub fn validate_action(
    lock: &LockRecord,
    action: &RemoteAuthorization,
    destination: &Pubkey,
    now: i64,
) -> ProgramResult {
    if action.kind > SEIZE
        || action.amount_lamports == 0
        || action.amount_lamports > lock.remaining_amount
        || action.monad_chain != lock.monad_chain
        || action.monad_core != lock.monad_core
        || action.source_genesis != lock.source_genesis
        || action.source_vault != lock.source_vault
        || action.credit_id != lock.credit_id
        || action.lock_id != lock.lock_id
        || action.asset != lock.asset
        || action.verifier_version != lock.verifier_version
    {
        return Err(VaultError::InvalidAction.into());
    }
    if action.nonce <= lock.last_nonce
        || action.nonce == 0
        || action.revision <= lock.last_revision
        || action.revision == 0
    {
        return Err(VaultError::Replay.into());
    }
    if action.deadline <= 0 || now > action.deadline {
        return Err(VaultError::Expired.into());
    }
    let expected_recipient = if action.kind == RELEASE {
        lock.return_recipient
    } else {
        lock.recovery_vault
    };
    if action.recipient != expected_recipient || action.recipient != destination.to_bytes() {
        return Err(VaultError::InvalidAction.into());
    }
    Ok(())
}

fn uint_word(value: u64) -> [u8; 32] {
    let mut word = [0; 32];
    word[24..].copy_from_slice(&value.to_be_bytes());
    word
}

fn address_word(value: &[u8; 20]) -> [u8; 32] {
    let mut word = [0; 32];
    word[12..].copy_from_slice(value);
    word
}

pub fn solana_lock_digest(record: &LockRecord) -> Result<[u8; 32], ProgramError> {
    let setup_deadline =
        u64::try_from(record.setup_deadline).map_err(|_| VaultError::InvalidBinding)?;
    let domain = keccak::hash(b"Termbook Solana lock v1");
    let mut encoded = Vec::with_capacity(17 * 32);
    for word in [
        domain.to_bytes(),
        record.credit_id,
        record.lock_id,
        record.source_genesis,
        record.source_program,
        record.source_vault,
        record.asset,
        record.owner,
        address_word(&record.monad_borrower),
        record.return_recipient,
        record.recovery_vault,
        uint_word(record.monad_chain),
        address_word(&record.monad_core),
        uint_word(record.initial_amount),
        uint_word(setup_deadline),
        record.terms_hash,
        uint_word(record.verifier_version),
    ] {
        encoded.extend_from_slice(&word);
    }
    Ok(keccak::hash(&encoded).to_bytes())
}

pub fn solana_action_hash(
    record: &LockRecord,
    action: &RemoteAuthorization,
) -> Result<[u8; 32], ProgramError> {
    let deadline = u64::try_from(action.deadline).map_err(|_| VaultError::InvalidAction)?;
    let domain = keccak::hash(b"Termbook Solana action v1");
    let mut encoded = Vec::with_capacity(16 * 32);
    for word in [
        domain.to_bytes(),
        uint_word(record.monad_chain),
        address_word(&record.monad_core),
        record.source_genesis,
        record.source_program,
        record.source_vault,
        record.credit_id,
        record.lock_id,
        record.asset,
        uint_word(u64::from(action.kind)),
        action.recipient,
        uint_word(action.amount_lamports),
        uint_word(action.nonce),
        uint_word(action.revision),
        uint_word(deadline),
        uint_word(record.verifier_version),
    ] {
        encoded.extend_from_slice(&word);
    }
    Ok(keccak::hash(&encoded).to_bytes())
}

pub fn solana_recovery_payout_hash(
    lock: &LockRecord,
    payout: &RecoveryPayoutRequest,
) -> Result<[u8; 32], ProgramError> {
    let deadline = u64::try_from(payout.deadline).map_err(|_| VaultError::InvalidAction)?;
    let domain = keccak::hash(b"Termbook Solana recovery payout v1");
    let mut encoded = Vec::with_capacity(13 * 32);
    for word in [
        domain.to_bytes(),
        uint_word(lock.monad_chain),
        address_word(&lock.monad_core),
        lock.source_genesis,
        lock.source_program,
        lock.recovery_vault,
        lock.credit_id,
        lock.asset,
        payout.recipient,
        uint_word(payout.amount_lamports),
        uint_word(payout.nonce),
        uint_word(payout.revision),
        uint_word(deadline),
    ] {
        encoded.extend_from_slice(&word);
    }
    Ok(keccak::hash(&encoded).to_bytes())
}

pub fn solana_recovery_funding_hash(
    lock: &LockRecord,
    funding: &RecoveryFundingRequest,
) -> Result<[u8; 32], ProgramError> {
    let deadline = u64::try_from(funding.deadline).map_err(|_| VaultError::InvalidAction)?;
    let domain = keccak::hash(b"Termbook Solana recovery fund v1");
    let mut encoded = Vec::with_capacity(17 * 32);
    for word in [
        domain.to_bytes(),
        uint_word(lock.monad_chain),
        address_word(&lock.monad_core),
        lock.source_genesis,
        lock.source_program,
        lock.recovery_vault,
        lock.credit_id,
        lock.asset,
        funding.operation_id,
        funding.operation_digest,
        address_word(&funding.inbox),
        funding.deposit_pubkey,
        uint_word(funding.amount_lamports),
        funding.quote_hash,
        uint_word(funding.nonce),
        uint_word(funding.revision),
        uint_word(deadline),
    ] {
        encoded.extend_from_slice(&word);
    }
    Ok(keccak::hash(&encoded).to_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_program_id() -> Pubkey {
        Pubkey::new_from_array([11; 32])
    }

    fn request() -> LockRequest {
        LockRequest {
            lock_id: [1; 32],
            credit_id: [2; 32],
            monad_chain: 143,
            monad_core: [3; 20],
            monad_borrower: [4; 20],
            source_genesis: [5; 32],
            return_recipient: [6; 32],
            recovery_vault: recovery_address(&test_program_id(), &[2; 32]).0.to_bytes(),
            terms_hash: [8; 32],
            amount_lamports: 1_000_000_000,
            setup_deadline: 100,
            verifier_version: 1,
        }
    }

    fn record() -> LockRecord {
        let input = request();
        LockRecord {
            version: LOCK_VERSION,
            bump: 254,
            lock_id: input.lock_id,
            credit_id: input.credit_id,
            owner: [9; 32],
            monad_chain: input.monad_chain,
            monad_core: input.monad_core,
            monad_borrower: input.monad_borrower,
            source_genesis: input.source_genesis,
            source_program: [11; 32],
            source_vault: [10; 32],
            asset: NATIVE_SOL_ASSET_ID,
            return_recipient: input.return_recipient,
            recovery_vault: input.recovery_vault,
            terms_hash: input.terms_hash,
            initial_amount: input.amount_lamports,
            remaining_amount: input.amount_lamports,
            setup_deadline: input.setup_deadline,
            verifier_version: input.verifier_version,
            last_nonce: 0,
            last_revision: 0,
            last_action_hash: [0; 32],
            last_canceled_nonce: 0,
            last_canceled_action_hash: [0; 32],
        }
    }

    fn action(kind: u8) -> RemoteAuthorization {
        let lock = record();
        RemoteAuthorization {
            monad_chain: lock.monad_chain,
            monad_core: lock.monad_core,
            source_genesis: lock.source_genesis,
            source_vault: lock.source_vault,
            credit_id: lock.credit_id,
            lock_id: lock.lock_id,
            asset: lock.asset,
            kind,
            recipient: if kind == RELEASE {
                lock.return_recipient
            } else {
                lock.recovery_vault
            },
            amount_lamports: 500_000_000,
            nonce: 1,
            revision: 2,
            deadline: 100,
            verifier_version: 1,
        }
    }

    fn payout() -> RecoveryPayoutRequest {
        RecoveryPayoutRequest {
            recipient: [6; 32],
            amount_lamports: 500_000_000,
            nonce: 1,
            revision: 4,
            deadline: 100,
        }
    }

    fn funding() -> RecoveryFundingRequest {
        RecoveryFundingRequest {
            operation_id: [12; 32],
            operation_digest: [13; 32],
            inbox: [14; 20],
            deposit_pubkey: [15; 32],
            amount_lamports: 500_000_000,
            quote_hash: [16; 32],
            nonce: 1,
            revision: 4,
            deadline: 100,
        }
    }

    #[test]
    fn lock_requires_all_identity_fields_and_deadline() {
        let owner = Pubkey::new_unique();
        assert!(validate_lock(&request(), &owner, 100).is_ok());
        let mut bad = request();
        bad.monad_borrower = [0; 20];
        assert_eq!(
            validate_lock(&bad, &owner, 99),
            Err(VaultError::InvalidBinding.into())
        );
        assert_eq!(
            validate_lock(&request(), &owner, 101),
            Err(VaultError::Expired.into())
        );
    }

    #[test]
    fn release_and_seizure_bind_distinct_recipients() {
        let lock = record();
        assert!(validate_action(
            &lock,
            &action(RELEASE),
            &Pubkey::new_from_array([6; 32]),
            100
        )
        .is_ok());
        assert!(validate_action(
            &lock,
            &action(SEIZE),
            &Pubkey::new_from_array(lock.recovery_vault),
            100
        )
        .is_ok());
        assert_eq!(
            validate_action(&lock, &action(SEIZE), &Pubkey::new_from_array([6; 32]), 100),
            Err(VaultError::InvalidAction.into()),
        );
    }

    #[test]
    fn action_rejects_wrong_core_amount_and_replay() {
        let lock = record();
        let destination = Pubkey::new_from_array([6; 32]);
        let mut wrong = action(RELEASE);
        wrong.monad_core = [11; 20];
        assert_eq!(
            validate_action(&lock, &wrong, &destination, 50),
            Err(VaultError::InvalidAction.into())
        );
        wrong = action(RELEASE);
        wrong.amount_lamports = lock.remaining_amount + 1;
        assert_eq!(
            validate_action(&lock, &wrong, &destination, 50),
            Err(VaultError::InvalidAction.into())
        );
        wrong = action(RELEASE);
        wrong.nonce = 0;
        assert_eq!(
            validate_action(&lock, &wrong, &destination, 50),
            Err(VaultError::Replay.into())
        );
        wrong = action(RELEASE);
        wrong.nonce = 1;
        let mut consumed = lock;
        consumed.last_nonce = 1;
        assert_eq!(
            validate_action(&consumed, &wrong, &destination, 50),
            Err(VaultError::Replay.into())
        );
        wrong = action(RELEASE);
        wrong.revision = 0;
        assert_eq!(
            validate_action(&record(), &wrong, &destination, 50),
            Err(VaultError::Replay.into())
        );
        wrong.revision = 2;
        let mut consumed = record();
        consumed.last_revision = 2;
        assert_eq!(
            validate_action(&consumed, &wrong, &destination, 50),
            Err(VaultError::Replay.into())
        );
    }

    #[test]
    fn action_rejects_cross_chain_and_version_substitution() {
        let lock = record();
        let destination = Pubkey::new_from_array([6; 32]);
        let mut wrong = action(RELEASE);
        wrong.source_genesis = [12; 32];
        assert_eq!(
            validate_action(&lock, &wrong, &destination, 50),
            Err(VaultError::InvalidAction.into())
        );
        wrong = action(RELEASE);
        wrong.source_vault = [12; 32];
        assert_eq!(
            validate_action(&lock, &wrong, &destination, 50),
            Err(VaultError::InvalidAction.into())
        );
        wrong = action(RELEASE);
        wrong.credit_id = [12; 32];
        assert_eq!(
            validate_action(&lock, &wrong, &destination, 50),
            Err(VaultError::InvalidAction.into())
        );
        wrong = action(RELEASE);
        wrong.asset = [12; 32];
        assert_eq!(
            validate_action(&lock, &wrong, &destination, 50),
            Err(VaultError::InvalidAction.into())
        );
        wrong = action(RELEASE);
        wrong.verifier_version += 1;
        assert_eq!(
            validate_action(&lock, &wrong, &destination, 50),
            Err(VaultError::InvalidAction.into())
        );
    }

    #[test]
    fn action_rejects_expired_and_unknown_kind() {
        let lock = record();
        let destination = Pubkey::new_from_array([6; 32]);
        assert_eq!(
            validate_action(&lock, &action(RELEASE), &destination, 101),
            Err(VaultError::Expired.into())
        );
        let mut wrong = action(RELEASE);
        wrong.kind = 2;
        assert_eq!(
            validate_action(&lock, &wrong, &destination, 50),
            Err(VaultError::InvalidAction.into())
        );
    }

    #[test]
    fn wormhole_instruction_encoding() {
        let authorization = action(RELEASE);
        let request = ApplyRequest { authorization };
        let encoded = borsh::to_vec(&VaultInstruction::Apply(request.clone())).unwrap();
        assert_eq!(
            VaultInstruction::try_from_slice(&encoded).unwrap(),
            VaultInstruction::Apply(request.clone())
        );
        let expire = borsh::to_vec(&VaultInstruction::Expire(request.clone())).unwrap();
        assert_eq!(
            VaultInstruction::try_from_slice(&expire).unwrap(),
            VaultInstruction::Expire(request.clone())
        );
        let funding = funding();
        let encoded = borsh::to_vec(&VaultInstruction::FundRecovery(funding.clone())).unwrap();
        assert_eq!(
            VaultInstruction::try_from_slice(&encoded).unwrap(),
            VaultInstruction::FundRecovery(funding.clone())
        );
        let checkpoint = RecoveryCheckpointRequest { deadline: 100 };
        let encoded =
            borsh::to_vec(&VaultInstruction::CheckpointRecovery(checkpoint.clone())).unwrap();
        assert_eq!(
            VaultInstruction::try_from_slice(&encoded).unwrap(),
            VaultInstruction::CheckpointRecovery(checkpoint)
        );
        let lock_checkpoint = borsh::to_vec(&VaultInstruction::CheckpointLock).unwrap();
        assert_eq!(lock_checkpoint, vec![7]);
    }

    #[test]
    fn lock_requires_frozen_program_data() {
        let loader = "BPFLoaderUpgradeab1e11111111111111111111111"
            .parse::<Pubkey>()
            .unwrap();
        let program_id = Pubkey::new_unique();
        let data_key = Pubkey::new_unique();
        let mut program_lamports = 1;
        let mut data_lamports = 1;
        let mut program_bytes = [0u8; 36];
        program_bytes[..4].copy_from_slice(&2u32.to_le_bytes());
        program_bytes[4..36].copy_from_slice(data_key.as_ref());
        let mut data_bytes = [0u8; 45];
        data_bytes[..4].copy_from_slice(&3u32.to_le_bytes());
        let program = AccountInfo::new(
            &program_id,
            false,
            false,
            &mut program_lamports,
            &mut program_bytes,
            &loader,
            true,
        );
        let data = AccountInfo::new(
            &data_key,
            false,
            false,
            &mut data_lamports,
            &mut data_bytes,
            &loader,
            false,
        );
        assert_eq!(
            verify_immutable_program(&program_id, &program, &data),
            Ok(())
        );
        drop(data);
        data_bytes[12] = 1;
        let data = AccountInfo::new(
            &data_key,
            false,
            false,
            &mut data_lamports,
            &mut data_bytes,
            &loader,
            false,
        );
        assert!(verify_immutable_program(&program_id, &program, &data).is_err());
    }

    #[test]
    fn action_hash_matches_solidity_abi_encoding() {
        let actual = solana_action_hash(&record(), &action(RELEASE)).unwrap();
        let expected = [
            0x1c, 0x59, 0xeb, 0x45, 0x70, 0x3b, 0x3d, 0xd1, 0x37, 0x50, 0x20, 0xa5, 0x56, 0x8a,
            0x87, 0xc6, 0xf7, 0xf6, 0x87, 0xfc, 0xdd, 0x96, 0xa5, 0x6d, 0xfc, 0x6d, 0x4f, 0x66,
            0xc0, 0x46, 0x16, 0xc8,
        ];
        assert_eq!(actual, expected);
    }

    #[test]
    fn lock_digest_matches_solidity_abi_encoding_and_binds_custody() {
        let original = record();
        let expected = [
            0xad, 0x20, 0x02, 0xe7, 0x11, 0xc5, 0xc0, 0x56, 0x68, 0x07, 0x1f, 0xde, 0xb5, 0xd2,
            0xcd, 0x81, 0x08, 0x16, 0x51, 0x40, 0x06, 0xe4, 0x31, 0x72, 0xf6, 0x03, 0x10, 0xb7,
            0xa6, 0x95, 0x66, 0xf2,
        ];
        assert_eq!(solana_lock_digest(&original).unwrap(), expected);
        let mut changed = original.clone();
        changed.owner = [3; 32];
        assert_ne!(solana_lock_digest(&changed).unwrap(), expected);
        changed = original.clone();
        changed.source_vault = [3; 32];
        assert_ne!(solana_lock_digest(&changed).unwrap(), expected);
        changed = original.clone();
        changed.recovery_vault = [3; 32];
        assert_ne!(solana_lock_digest(&changed).unwrap(), expected);
        changed = original;
        changed.setup_deadline = -1;
        assert_eq!(
            solana_lock_digest(&changed),
            Err(VaultError::InvalidBinding.into())
        );
    }

    #[test]
    fn payout_hash_matches_solidity_abi_encoding() {
        let expected = [
            0x59, 0xb7, 0x8f, 0x44, 0x88, 0x54, 0xbb, 0x2e, 0xea, 0x58, 0x33, 0x0e, 0xc8, 0x22,
            0xe6, 0x27, 0x7c, 0xfa, 0x4a, 0x47, 0x5f, 0xef, 0xba, 0xa3, 0x13, 0x95, 0xba, 0xe7,
            0xc2, 0xce, 0xca, 0x58,
        ];
        assert_eq!(
            solana_recovery_payout_hash(&record(), &payout()).unwrap(),
            expected
        );
        let mut changed = payout();
        changed.recipient = [7; 32];
        assert_ne!(
            solana_recovery_payout_hash(&record(), &changed).unwrap(),
            expected
        );
        changed = payout();
        changed.deadline = -1;
        assert_eq!(
            solana_recovery_payout_hash(&record(), &changed),
            Err(VaultError::InvalidAction.into())
        );
    }

    #[test]
    fn funding_hash_matches_solidity_abi_encoding() {
        let expected = [
            0xe6, 0xa6, 0x69, 0xe3, 0xcc, 0x25, 0xa4, 0xef, 0x0e, 0x19, 0x7c, 0x04, 0x25, 0x24,
            0x80, 0xc4, 0xe1, 0x38, 0xda, 0x59, 0x9f, 0xdf, 0x35, 0x5d, 0xb9, 0x17, 0xb1, 0x5c,
            0x9a, 0x1b, 0xae, 0x08,
        ];
        assert_eq!(
            solana_recovery_funding_hash(&record(), &funding()).unwrap(),
            expected
        );
        let mut changed = funding();
        changed.deposit_pubkey = [17; 32];
        assert_ne!(
            solana_recovery_funding_hash(&record(), &changed).unwrap(),
            expected
        );
        changed = funding();
        changed.operation_digest = [17; 32];
        assert_ne!(
            solana_recovery_funding_hash(&record(), &changed).unwrap(),
            expected
        );
        changed = funding();
        changed.deadline = -1;
        assert_eq!(
            solana_recovery_funding_hash(&record(), &changed),
            Err(VaultError::InvalidAction.into())
        );
    }

    #[test]
    fn verified_actions_move_only_collateral_and_preserve_state() {
        let mut stored = record();
        let lock_key = Pubkey::new_from_array(stored.source_vault);
        let recipient_key = Pubkey::new_from_array(stored.return_recipient);
        let recovery_key = Pubkey::new_from_array(stored.recovery_vault);
        let program_id = test_program_id();
        let system_id = system_program::id();
        let rent_reserve = 20_000;
        let recovery_rent_reserve = 20_000;
        let mut lock_balance = rent_reserve + stored.initial_amount + 50;
        let mut recipient_balance = 100;
        let mut recovery_balance = recovery_rent_reserve + 200;
        let initial_total = lock_balance + recipient_balance + recovery_balance;
        let mut lock_data = borsh::to_vec(&stored).unwrap();
        let mut recipient_data = [];
        let recovery_record = RecoveryRecord {
            version: RECOVERY_VERSION,
            bump: recovery_address(&program_id, &stored.credit_id).1,
            credit_id: stored.credit_id,
            lock_id: stored.lock_id,
            owner: stored.owner,
            source_vault: stored.source_vault,
            held_lamports: 0,
            last_seizure_hash: [0; 32],
            last_payout_nonce: 0,
            last_payout_revision: 0,
            last_payout_hash: [0; 32],
            funded_lamports: 0,
            last_funding_nonce: 0,
            last_funding_revision: 0,
            last_funding_hash: [0; 32],
            refunded_lamports: 0,
        };
        let mut recovery_data = borsh::to_vec(&recovery_record).unwrap();
        let lock_account = AccountInfo::new(
            &lock_key,
            false,
            true,
            &mut lock_balance,
            &mut lock_data,
            &program_id,
            false,
        );
        let recipient_account = AccountInfo::new(
            &recipient_key,
            false,
            true,
            &mut recipient_balance,
            &mut recipient_data,
            &system_id,
            false,
        );
        let recovery_account = AccountInfo::new(
            &recovery_key,
            false,
            true,
            &mut recovery_balance,
            &mut recovery_data,
            &program_id,
            false,
        );

        let release = action(RELEASE);
        apply_verified_action(
            &program_id,
            &lock_account,
            &recipient_account,
            stored,
            &release,
            50,
            AccountRent {
                lock: rent_reserve,
                recovery: recovery_rent_reserve,
            },
        )
        .unwrap();
        stored = LockRecord::try_from_slice(&lock_account.data.borrow()).unwrap();
        assert_eq!(stored.remaining_amount, 500_000_000);
        assert_eq!(stored.last_nonce, 1);
        assert_eq!(stored.last_revision, 2);
        assert_eq!(
            stored.last_action_hash,
            solana_action_hash(&record(), &release).unwrap()
        );
        assert_eq!(recipient_account.lamports(), 500_000_100);
        assert_eq!(lock_account.lamports(), rent_reserve + 500_000_050);
        assert_eq!(
            lock_account.lamports() + recipient_account.lamports() + recovery_account.lamports(),
            initial_total
        );

        let mut seizure = action(SEIZE);
        seizure.nonce = 2;
        seizure.revision = 3;
        apply_verified_action(
            &program_id,
            &lock_account,
            &recovery_account,
            stored,
            &seizure,
            50,
            AccountRent {
                lock: rent_reserve,
                recovery: recovery_rent_reserve,
            },
        )
        .unwrap();
        stored = LockRecord::try_from_slice(&lock_account.data.borrow()).unwrap();
        assert_eq!(stored.remaining_amount, 0);
        assert_eq!(stored.last_nonce, 2);
        assert_eq!(stored.last_revision, 3);
        assert_eq!(
            stored.last_action_hash,
            solana_action_hash(&record(), &seizure).unwrap()
        );
        let held = RecoveryRecord::try_from_slice(&recovery_account.data.borrow()).unwrap();
        assert_eq!(held.held_lamports, 500_000_000);
        assert_eq!(held.last_seizure_hash, stored.last_action_hash);
        assert_eq!(
            recovery_account.lamports(),
            recovery_rent_reserve + 500_000_200
        );
        assert_eq!(lock_account.lamports(), rent_reserve + 50);
        assert_eq!(
            lock_account.lamports() + recipient_account.lamports() + recovery_account.lamports(),
            initial_total
        );
    }

    #[test]
    fn verified_action_rejects_replay_and_missing_collateral() {
        let stored = record();
        let lock_key = Pubkey::new_from_array(stored.source_vault);
        let recipient_key = Pubkey::new_from_array(stored.return_recipient);
        let program_id = Pubkey::new_unique();
        let system_id = system_program::id();
        let rent_reserve = 20_000;
        let mut lock_balance = rent_reserve + stored.initial_amount - 1;
        let mut recipient_balance = 100;
        let mut lock_data = borsh::to_vec(&stored).unwrap();
        let mut recipient_data = [];
        let lock_account = AccountInfo::new(
            &lock_key,
            false,
            true,
            &mut lock_balance,
            &mut lock_data,
            &program_id,
            false,
        );
        let recipient_account = AccountInfo::new(
            &recipient_key,
            false,
            true,
            &mut recipient_balance,
            &mut recipient_data,
            &system_id,
            false,
        );
        let release = action(RELEASE);
        assert_eq!(
            apply_verified_action(
                &program_id,
                &lock_account,
                &recipient_account,
                stored.clone(),
                &release,
                50,
                AccountRent {
                    lock: rent_reserve,
                    recovery: 0
                },
            ),
            Err(VaultError::InvalidBinding.into())
        );
        assert_eq!(
            lock_account.lamports(),
            rent_reserve + stored.initial_amount - 1
        );
        assert_eq!(recipient_account.lamports(), 100);

        let mut consumed = stored;
        consumed.last_nonce = 1;
        assert_eq!(
            apply_verified_action(
                &program_id,
                &lock_account,
                &recipient_account,
                consumed,
                &release,
                50,
                AccountRent {
                    lock: rent_reserve,
                    recovery: 0
                },
            ),
            Err(VaultError::Replay.into())
        );
    }

    #[test]
    fn expiration_records_nonexecution_and_blocks_late_apply() {
        let stored = record();
        let lock_key = Pubkey::new_from_array(stored.source_vault);
        let recipient_key = Pubkey::new_from_array(stored.return_recipient);
        let program_id = test_program_id();
        let system_id = system_program::id();
        let reserve = 20_000;
        let mut lock_balance = reserve + stored.initial_amount;
        let mut recipient_balance = 0;
        let mut lock_data = borsh::to_vec(&stored).unwrap();
        let mut recipient_data = [];
        let lock_account = AccountInfo::new(
            &lock_key,
            false,
            true,
            &mut lock_balance,
            &mut lock_data,
            &program_id,
            false,
        );
        let recipient_account = AccountInfo::new(
            &recipient_key,
            false,
            true,
            &mut recipient_balance,
            &mut recipient_data,
            &system_id,
            false,
        );
        let expired = action(RELEASE);
        assert_eq!(
            expire_verified_action(&lock_account, stored.clone(), &expired, expired.deadline),
            Err(VaultError::InvalidAction.into())
        );
        expire_verified_action(&lock_account, stored, &expired, expired.deadline + 1).unwrap();
        let canceled = LockRecord::try_from_slice(&lock_account.data.borrow()).unwrap();
        assert_eq!(canceled.last_nonce, expired.nonce);
        assert_eq!(canceled.last_revision, expired.revision);
        assert_eq!(canceled.last_canceled_nonce, expired.nonce);
        assert_eq!(
            canceled.last_canceled_action_hash,
            solana_action_hash(&record(), &expired).unwrap()
        );
        assert_eq!(canceled.last_action_hash, [0; 32]);
        assert_eq!(canceled.remaining_amount, 1_000_000_000);
        assert_eq!(lock_account.lamports(), reserve + 1_000_000_000);
        assert_eq!(recipient_account.lamports(), 0);
        assert_eq!(
            validate_action(&canceled, &expired, &recipient_key, 99),
            Err(VaultError::Replay.into())
        );

        let mut next = action(RELEASE);
        next.nonce = 2;
        next.revision = 3;
        apply_verified_action(
            &program_id,
            &lock_account,
            &recipient_account,
            canceled,
            &next,
            99,
            AccountRent {
                lock: reserve,
                recovery: 0,
            },
        )
        .unwrap();
        let after = LockRecord::try_from_slice(&lock_account.data.borrow()).unwrap();
        assert_eq!(after.last_canceled_nonce, expired.nonce);
        assert_eq!(
            after.last_canceled_action_hash,
            solana_action_hash(&record(), &expired).unwrap()
        );
        assert_eq!(
            after.last_action_hash,
            solana_action_hash(&record(), &next).unwrap()
        );
    }

    #[test]
    fn seizure_requires_derived_program_owned_recovery_ledger() {
        let lock = record();
        let recovery_key = Pubkey::new_from_array(lock.recovery_vault);
        let program_id = test_program_id();
        let wrong_owner = system_program::id();
        let reserve = 20_000;
        let mut lamports = reserve;
        let mut data = borsh::to_vec(&RecoveryRecord {
            version: RECOVERY_VERSION,
            bump: recovery_address(&program_id, &lock.credit_id).1,
            credit_id: lock.credit_id,
            lock_id: lock.lock_id,
            owner: lock.owner,
            source_vault: lock.source_vault,
            held_lamports: 0,
            last_seizure_hash: [0; 32],
            last_payout_nonce: 0,
            last_payout_revision: 0,
            last_payout_hash: [0; 32],
            funded_lamports: 0,
            last_funding_nonce: 0,
            last_funding_revision: 0,
            last_funding_hash: [0; 32],
            refunded_lamports: 0,
        })
        .unwrap();
        let forged = AccountInfo::new(
            &recovery_key,
            false,
            true,
            &mut lamports,
            &mut data,
            &wrong_owner,
            false,
        );
        assert_eq!(
            prepare_recovery_update(&program_id, &forged, &lock, 1, [9; 32], reserve),
            Err(VaultError::InvalidBinding.into())
        );
        assert_ne!(recovery_address(&program_id, &[3; 32]).0, recovery_key);
    }

    #[test]
    fn recovery_payout_returns_only_authorized_surplus_and_preserves_rent() {
        let mut lock = record();
        let program_id = test_program_id();
        let (lock_pda, lock_bump) =
            Pubkey::find_program_address(&[LOCK_SEED, &lock.lock_id], &program_id);
        lock.source_vault = lock_pda.to_bytes();
        lock.bump = lock_bump;
        lock.remaining_amount = 0;
        lock.last_nonce = 1;
        lock.last_revision = 3;
        lock.last_action_hash = [9; 32];
        let lock_key = Pubkey::new_from_array(lock.source_vault);
        let recovery_key = Pubkey::new_from_array(lock.recovery_vault);
        let recipient_key = Pubkey::new_from_array(lock.return_recipient);
        let system_id = system_program::id();
        let reserve = 20_000;
        let mut lock_balance = reserve;
        let mut recovery_balance = reserve + 1_000_000_050;
        let mut recipient_balance = 100;
        let initial_total = lock_balance + recovery_balance + recipient_balance;
        let mut lock_data = borsh::to_vec(&lock).unwrap();
        let mut recovery_data = borsh::to_vec(&RecoveryRecord {
            version: RECOVERY_VERSION,
            bump: recovery_address(&program_id, &lock.credit_id).1,
            credit_id: lock.credit_id,
            lock_id: lock.lock_id,
            owner: lock.owner,
            source_vault: lock.source_vault,
            held_lamports: 1_000_000_000,
            last_seizure_hash: [9; 32],
            last_payout_nonce: 0,
            last_payout_revision: 0,
            last_payout_hash: [0; 32],
            funded_lamports: 0,
            last_funding_nonce: 0,
            last_funding_revision: 0,
            last_funding_hash: [0; 32],
            refunded_lamports: 0,
        })
        .unwrap();
        let mut recipient_data = [];
        let lock_account = AccountInfo::new(
            &lock_key,
            false,
            true,
            &mut lock_balance,
            &mut lock_data,
            &program_id,
            false,
        );
        let recovery_account = AccountInfo::new(
            &recovery_key,
            false,
            true,
            &mut recovery_balance,
            &mut recovery_data,
            &program_id,
            false,
        );
        let recipient_account = AccountInfo::new(
            &recipient_key,
            false,
            true,
            &mut recipient_balance,
            &mut recipient_data,
            &system_id,
            false,
        );
        let authorized = payout();
        let loaded_lock = load_lock(&program_id, &lock_account).unwrap();
        let stored = load_recovery(&program_id, &recovery_account, &loaded_lock, reserve).unwrap();
        validate_recovery_payout(&loaded_lock, &stored, &authorized, &recipient_key, 99).unwrap();
        let hash = solana_recovery_payout_hash(&loaded_lock, &authorized).unwrap();
        apply_verified_recovery_payout(
            &lock_account,
            loaded_lock,
            &recovery_account,
            &recipient_account,
            stored,
            &authorized,
            hash,
        )
        .unwrap();
        let after = RecoveryRecord::try_from_slice(&recovery_account.data.borrow()).unwrap();
        let after_lock = LockRecord::try_from_slice(&lock_account.data.borrow()).unwrap();
        assert_eq!(after.held_lamports, 500_000_000);
        assert_eq!(after_lock.last_revision, 4);
        assert_eq!(after_lock.last_action_hash, [9; 32]);
        assert_eq!(after.last_payout_nonce, 1);
        assert_eq!(after.last_payout_revision, 4);
        assert_eq!(after.last_payout_hash, hash);
        assert_eq!(recovery_account.lamports(), reserve + 500_000_050);
        assert_eq!(recipient_account.lamports(), 500_000_100);
        assert_eq!(
            lock_account.lamports() + recovery_account.lamports() + recipient_account.lamports(),
            initial_total
        );
        assert_eq!(
            validate_recovery_payout(&after_lock, &after, &authorized, &recipient_key, 99),
            Err(VaultError::Replay.into())
        );
        let mut wrong = payout();
        wrong.recipient = [7; 32];
        assert_eq!(
            validate_recovery_payout(&after_lock, &after, &wrong, &recipient_key, 99),
            Err(VaultError::InvalidAction.into())
        );
    }

    #[test]
    fn recovery_funding_preserves_rent_and_conflicts_with_payout() {
        let mut lock = record();
        let program_id = test_program_id();
        let (lock_pda, lock_bump) =
            Pubkey::find_program_address(&[LOCK_SEED, &lock.lock_id], &program_id);
        lock.source_vault = lock_pda.to_bytes();
        lock.bump = lock_bump;
        lock.remaining_amount = 0;
        lock.last_nonce = 1;
        lock.last_revision = 3;
        lock.last_action_hash = [9; 32];
        let lock_key = Pubkey::new_from_array(lock.source_vault);
        let recovery_key = Pubkey::new_from_array(lock.recovery_vault);
        let deposit_key = Pubkey::new_from_array([15; 32]);
        let recipient_key = Pubkey::new_from_array(lock.return_recipient);
        let system_id = system_program::id();
        let reserve = 20_000;
        let mut lock_balance = reserve;
        let mut recovery_balance = reserve + 1_000_000_050;
        let mut deposit_balance = 100;
        let mut recipient_balance = 200;
        let initial_total = lock_balance + recovery_balance + deposit_balance + recipient_balance;
        let mut lock_data = borsh::to_vec(&lock).unwrap();
        let mut recovery_data = borsh::to_vec(&RecoveryRecord {
            version: RECOVERY_VERSION,
            bump: recovery_address(&program_id, &lock.credit_id).1,
            credit_id: lock.credit_id,
            lock_id: lock.lock_id,
            owner: lock.owner,
            source_vault: lock.source_vault,
            held_lamports: 1_000_000_000,
            last_seizure_hash: [9; 32],
            last_payout_nonce: 0,
            last_payout_revision: 0,
            last_payout_hash: [0; 32],
            funded_lamports: 0,
            last_funding_nonce: 0,
            last_funding_revision: 0,
            last_funding_hash: [0; 32],
            refunded_lamports: 0,
        })
        .unwrap();
        let mut deposit_data = [];
        let mut recipient_data = [];
        let lock_account = AccountInfo::new(
            &lock_key,
            false,
            true,
            &mut lock_balance,
            &mut lock_data,
            &program_id,
            false,
        );
        let recovery_account = AccountInfo::new(
            &recovery_key,
            false,
            true,
            &mut recovery_balance,
            &mut recovery_data,
            &program_id,
            false,
        );
        let deposit_account = AccountInfo::new(
            &deposit_key,
            false,
            true,
            &mut deposit_balance,
            &mut deposit_data,
            &system_id,
            false,
        );
        let recipient_account = AccountInfo::new(
            &recipient_key,
            false,
            true,
            &mut recipient_balance,
            &mut recipient_data,
            &system_id,
            false,
        );
        let stored_lock = load_lock(&program_id, &lock_account).unwrap();
        let stored_recovery =
            load_recovery(&program_id, &recovery_account, &stored_lock, reserve).unwrap();
        let authorized = funding();
        validate_recovery_funding(
            &stored_lock,
            &stored_recovery,
            &authorized,
            &deposit_key,
            99,
        )
        .unwrap();
        let mut invalid = authorized.clone();
        invalid.deposit_pubkey = [17; 32];
        assert_eq!(
            validate_recovery_funding(&stored_lock, &stored_recovery, &invalid, &deposit_key, 99),
            Err(VaultError::InvalidAction.into())
        );
        invalid = authorized.clone();
        invalid.operation_id = [0; 32];
        assert_eq!(
            validate_recovery_funding(&stored_lock, &stored_recovery, &invalid, &deposit_key, 99),
            Err(VaultError::InvalidAction.into())
        );
        invalid = authorized.clone();
        invalid.amount_lamports = 1_000_000_001;
        assert_eq!(
            validate_recovery_funding(&stored_lock, &stored_recovery, &invalid, &deposit_key, 99),
            Err(VaultError::InvalidAction.into())
        );
        assert_eq!(
            validate_recovery_funding(
                &stored_lock,
                &stored_recovery,
                &authorized,
                &deposit_key,
                101
            ),
            Err(VaultError::Expired.into())
        );
        let funding_hash = solana_recovery_funding_hash(&stored_lock, &authorized).unwrap();
        apply_verified_recovery_funding(
            &lock_account,
            stored_lock,
            &recovery_account,
            &deposit_account,
            stored_recovery,
            &authorized,
            funding_hash,
        )
        .unwrap();
        let after_lock = load_lock(&program_id, &lock_account).unwrap();
        let after_funding =
            load_recovery(&program_id, &recovery_account, &after_lock, reserve).unwrap();
        assert_eq!(after_lock.last_revision, 4);
        assert_eq!(after_funding.held_lamports, 500_000_000);
        assert_eq!(after_funding.funded_lamports, 500_000_000);
        assert_eq!(after_funding.last_funding_nonce, 1);
        assert_eq!(after_funding.last_funding_revision, 4);
        assert_eq!(after_funding.last_funding_hash, funding_hash);
        assert_eq!(recovery_account.lamports(), reserve + 500_000_050);
        assert_eq!(deposit_account.lamports(), 500_000_100);
        assert_eq!(
            lock_account.lamports()
                + recovery_account.lamports()
                + deposit_account.lamports()
                + recipient_account.lamports(),
            initial_total
        );
        assert_eq!(
            validate_recovery_payout(&after_lock, &after_funding, &payout(), &recipient_key, 99),
            Err(VaultError::Replay.into())
        );
        let mut later_payout = payout();
        later_payout.nonce = 2;
        later_payout.revision = 5;
        later_payout.amount_lamports = 250_000_000;
        validate_recovery_payout(
            &after_lock,
            &after_funding,
            &later_payout,
            &recipient_key,
            99,
        )
        .unwrap();
        let payout_hash = solana_recovery_payout_hash(&after_lock, &later_payout).unwrap();
        apply_verified_recovery_payout(
            &lock_account,
            after_lock,
            &recovery_account,
            &recipient_account,
            after_funding,
            &later_payout,
            payout_hash,
        )
        .unwrap();
        let final_lock = load_lock(&program_id, &lock_account).unwrap();
        let final_recovery =
            load_recovery(&program_id, &recovery_account, &final_lock, reserve).unwrap();
        assert_eq!(final_recovery.held_lamports, 250_000_000);
        assert_eq!(final_recovery.funded_lamports, 500_000_000);
        assert_eq!(final_recovery.last_payout_nonce, 2);
        assert_eq!(final_recovery.last_funding_hash, funding_hash);
        assert_eq!(recipient_account.lamports(), 250_000_200);
        assert_eq!(recovery_account.lamports(), reserve + 250_000_050);
        let mut stale_funding = authorized.clone();
        stale_funding.amount_lamports = 250_000_000;
        assert_eq!(
            validate_recovery_funding(
                &final_lock,
                &final_recovery,
                &stale_funding,
                &deposit_key,
                99
            ),
            Err(VaultError::Replay.into())
        );
        assert_eq!(
            lock_account.lamports()
                + recovery_account.lamports()
                + deposit_account.lamports()
                + recipient_account.lamports(),
            initial_total
        );
    }

    #[test]
    fn refund_reconciliation_counts_only_available_lamports_and_funded_value() {
        let lock = record();
        let program_id = test_program_id();
        let recovery_key = Pubkey::new_from_array(lock.recovery_vault);
        let reserve = 20_000;
        let mut balance = reserve + 100 + 250;
        let mut data = borsh::to_vec(&RecoveryRecord {
            version: RECOVERY_VERSION,
            bump: recovery_address(&program_id, &lock.credit_id).1,
            credit_id: lock.credit_id,
            lock_id: lock.lock_id,
            owner: lock.owner,
            source_vault: lock.source_vault,
            held_lamports: 100,
            last_seizure_hash: [9; 32],
            last_payout_nonce: 0,
            last_payout_revision: 0,
            last_payout_hash: [0; 32],
            funded_lamports: 500,
            last_funding_nonce: 1,
            last_funding_revision: 4,
            last_funding_hash: [8; 32],
            refunded_lamports: 0,
        })
        .unwrap();
        assert_eq!(data.len(), 282);
        assert_eq!(&data[242..274], &[8; 32]);
        assert_eq!(&data[274..282], &[0; 8]);
        let account = AccountInfo::new(
            &recovery_key,
            false,
            true,
            &mut balance,
            &mut data,
            &program_id,
            false,
        );
        let initial = RecoveryRecord::try_from_slice(&account.data.borrow()).unwrap();
        assert_eq!(
            reconcile_recovery_refund(&account, initial.clone(), 251, reserve),
            Err(VaultError::InvalidAction.into())
        );
        reconcile_recovery_refund(&account, initial, 200, reserve).unwrap();
        let after = RecoveryRecord::try_from_slice(&account.data.borrow()).unwrap();
        assert_eq!(after.held_lamports, 300);
        assert_eq!(after.refunded_lamports, 200);
        assert_eq!(account.lamports(), reserve + 350);
        assert_eq!(
            reconcile_recovery_refund(&account, after.clone(), 200, reserve),
            Err(VaultError::InvalidAction.into())
        );
        reconcile_recovery_refund(&account, after, 50, reserve).unwrap();
        let after = RecoveryRecord::try_from_slice(&account.data.borrow()).unwrap();
        assert_eq!(after.held_lamports, 350);
        assert_eq!(after.refunded_lamports, 250);
        **account.try_borrow_mut_lamports().unwrap() += 350;
        reconcile_recovery_refund(&account, after, 250, reserve).unwrap();
        let final_record = RecoveryRecord::try_from_slice(&account.data.borrow()).unwrap();
        assert_eq!(final_record.held_lamports, 600);
        assert_eq!(final_record.refunded_lamports, 500);
        assert_eq!(account.lamports(), reserve + 700);
        assert_eq!(
            reconcile_recovery_refund(&account, final_record, 1, reserve),
            Err(VaultError::InvalidAction.into())
        );
    }

    #[test]
    fn refund_reconciliation_cannot_credit_donations_without_funding() {
        let lock = record();
        let program_id = test_program_id();
        let recovery_key = Pubkey::new_from_array(lock.recovery_vault);
        let reserve = 20_000;
        let mut balance = reserve + 1_000;
        let mut data = borsh::to_vec(&RecoveryRecord {
            version: RECOVERY_VERSION,
            bump: recovery_address(&program_id, &lock.credit_id).1,
            credit_id: lock.credit_id,
            lock_id: lock.lock_id,
            owner: lock.owner,
            source_vault: lock.source_vault,
            held_lamports: 0,
            last_seizure_hash: [0; 32],
            last_payout_nonce: 0,
            last_payout_revision: 0,
            last_payout_hash: [0; 32],
            funded_lamports: 0,
            last_funding_nonce: 0,
            last_funding_revision: 0,
            last_funding_hash: [0; 32],
            refunded_lamports: 0,
        })
        .unwrap();
        let account = AccountInfo::new(
            &recovery_key,
            false,
            true,
            &mut balance,
            &mut data,
            &program_id,
            false,
        );
        let record = RecoveryRecord::try_from_slice(&account.data.borrow()).unwrap();
        assert_eq!(
            reconcile_recovery_refund(&account, record, 1, reserve),
            Err(VaultError::InvalidAction.into())
        );
    }
}
