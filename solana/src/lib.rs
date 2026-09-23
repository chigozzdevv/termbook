use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};
use solana_system_interface::{instruction as system_instruction, program as system_program};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

const LOCK_SEED: &[u8] = b"termbook-lock";
const LOCK_VERSION: u8 = 1;
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
    Apply(RemoteAuthorization),
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
        VaultInstruction::Apply(action) => process_action(program_id, accounts, &action),
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
    let system = next_account_info(&mut accounts)?;
    let now = Clock::get()?.unix_timestamp;
    validate_lock(request, owner.key, now)?;
    require_admitted_verifier()?;
    if !owner.is_signer
        || !owner.is_writable
        || !lock.is_writable
        || *system.key != system_program::id()
    {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (expected, bump) = Pubkey::find_program_address(&[LOCK_SEED, &request.lock_id], program_id);
    if *lock.key != expected
        || !lock.data_is_empty()
        || lock.lamports() != 0
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
    };
    let serialized = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    let rent = Rent::get()?.minimum_balance(serialized.len());
    let deposit = rent
        .checked_add(request.amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let bump_seed = [bump];
    invoke_signed(
        &system_instruction::create_account(
            owner.key,
            lock.key,
            deposit,
            serialized.len() as u64,
            program_id,
        ),
        &[owner.clone(), lock.clone(), system.clone()],
        &[&[LOCK_SEED, &request.lock_id, &bump_seed]],
    )?;
    lock.data.borrow_mut().copy_from_slice(&serialized);
    Ok(())
}

fn process_action(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    action: &RemoteAuthorization,
) -> ProgramResult {
    let mut accounts = accounts.iter();
    let lock = next_account_info(&mut accounts)?;
    let destination = next_account_info(&mut accounts)?;
    if !lock.is_writable || !destination.is_writable || lock.owner != program_id {
        return Err(VaultError::InvalidBinding.into());
    }
    let record = LockRecord::try_from_slice(&lock.data.borrow())
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if record.version != LOCK_VERSION || record.source_vault != lock.key.to_bytes() {
        return Err(VaultError::InvalidBinding.into());
    }
    let (expected, bump) = Pubkey::find_program_address(&[LOCK_SEED, &record.lock_id], program_id);
    if *lock.key != expected || record.bump != bump {
        return Err(VaultError::InvalidBinding.into());
    }
    let now = Clock::get()?.unix_timestamp;
    validate_action(&record, action, destination.key, now)?;
    require_admitted_verifier()?;
    apply_verified_action(
        lock,
        destination,
        record,
        action,
        now,
        Rent::get()?.minimum_balance(lock.data_len()),
    )
}

fn apply_verified_action(
    lock: &AccountInfo,
    destination: &AccountInfo,
    mut record: LockRecord,
    action: &RemoteAuthorization,
    now: i64,
    rent_reserve: u64,
) -> ProgramResult {
    if lock.key == destination.key || !lock.is_writable || !destination.is_writable {
        return Err(VaultError::InvalidBinding.into());
    }
    validate_action(&record, action, destination.key, now)?;
    let balance = lock.lamports();
    let required = rent_reserve
        .checked_add(record.remaining_amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if balance < required {
        return Err(VaultError::InvalidBinding.into());
    }
    let destination_balance = destination
        .lamports()
        .checked_add(action.amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    record.remaining_amount = record
        .remaining_amount
        .checked_sub(action.amount_lamports)
        .ok_or(VaultError::InvalidAction)?;
    record.last_nonce = action.nonce;
    let serialized = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    if serialized.len() != lock.data_len() {
        return Err(ProgramError::InvalidAccountData);
    }
    let remaining_balance = balance
        .checked_sub(action.amount_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let mut lock_data = lock.try_borrow_mut_data()?;
    let mut lock_lamports = lock.try_borrow_mut_lamports()?;
    let mut destination_lamports = destination.try_borrow_mut_lamports()?;
    lock_data.copy_from_slice(&serialized);
    **lock_lamports = remaining_balance;
    **destination_lamports = destination_balance;
    Ok(())
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
    if action.nonce <= lock.last_nonce || action.nonce == 0 {
        return Err(VaultError::Replay.into());
    }
    if now > action.deadline {
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

fn require_admitted_verifier() -> ProgramResult {
    Err(VaultError::VerifierUnavailable.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> LockRequest {
        LockRequest {
            lock_id: [1; 32],
            credit_id: [2; 32],
            monad_chain: 143,
            monad_core: [3; 20],
            monad_borrower: [4; 20],
            source_genesis: [5; 32],
            return_recipient: [6; 32],
            recovery_vault: [7; 32],
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
            deadline: 100,
            verifier_version: 1,
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
        assert!(
            validate_action(&lock, &action(SEIZE), &Pubkey::new_from_array([7; 32]), 100).is_ok()
        );
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
    fn admission_is_closed() {
        assert_eq!(
            require_admitted_verifier(),
            Err(VaultError::VerifierUnavailable.into())
        );
    }

    #[test]
    fn verified_actions_move_only_collateral_and_preserve_state() {
        let mut stored = record();
        let lock_key = Pubkey::new_from_array(stored.source_vault);
        let recipient_key = Pubkey::new_from_array(stored.return_recipient);
        let recovery_key = Pubkey::new_from_array(stored.recovery_vault);
        let program_id = Pubkey::new_unique();
        let system_id = system_program::id();
        let rent_reserve = 20_000;
        let mut lock_balance = rent_reserve + stored.initial_amount + 50;
        let mut recipient_balance = 100;
        let mut recovery_balance = 200;
        let mut lock_data = borsh::to_vec(&stored).unwrap();
        let mut recipient_data = [];
        let mut recovery_data = [];
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
            &system_id,
            false,
        );

        let release = action(RELEASE);
        apply_verified_action(
            &lock_account,
            &recipient_account,
            stored,
            &release,
            50,
            rent_reserve,
        )
        .unwrap();
        stored = LockRecord::try_from_slice(&lock_account.data.borrow()).unwrap();
        assert_eq!(stored.remaining_amount, 500_000_000);
        assert_eq!(stored.last_nonce, 1);
        assert_eq!(recipient_account.lamports(), 500_000_100);
        assert_eq!(lock_account.lamports(), rent_reserve + 500_000_050);

        let mut seizure = action(SEIZE);
        seizure.nonce = 2;
        apply_verified_action(
            &lock_account,
            &recovery_account,
            stored,
            &seizure,
            50,
            rent_reserve,
        )
        .unwrap();
        stored = LockRecord::try_from_slice(&lock_account.data.borrow()).unwrap();
        assert_eq!(stored.remaining_amount, 0);
        assert_eq!(stored.last_nonce, 2);
        assert_eq!(recovery_account.lamports(), 500_000_200);
        assert_eq!(lock_account.lamports(), rent_reserve + 50);
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
                &lock_account,
                &recipient_account,
                stored.clone(),
                &release,
                50,
                rent_reserve,
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
                &lock_account,
                &recipient_account,
                consumed,
                &release,
                50,
                rent_reserve,
            ),
            Err(VaultError::Replay.into())
        );
    }
}
