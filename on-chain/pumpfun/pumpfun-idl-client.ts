import {
    Connection, PublicKey, TransactionInstruction,
    SystemProgram, SYSVAR_RENT_PUBKEY, Commitment, LAMPORTS_PER_SOL,
    Keypair,
    VersionedTransaction,
    TransactionMessage
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, createInitializeMintInstruction } from '@solana/spl-token';
import * as borsh from 'borsh';


// ============================================
// 1. EXACT IDL DEFINITIONS
// ============================================

// From IDL: programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
export const PUMP_FUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMP_FUN_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
export const FEE_PROGRAM_ID = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
export const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
export const PROTOCOL_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

export const METADATA_SEED = Buffer.from([
    11, 112, 101, 177, 227, 209, 124, 69, 56, 157, 82, 127, 107, 4, 195, 205,
    88, 184, 108, 115, 26, 160, 253, 181, 73, 182, 209, 188, 3, 248, 41, 70
]);

export const MINT_AUTHORITY_SEED = Buffer.from([
    109, 105, 110, 116, 45, 97, 117, 116, 104, 111, 114, 105, 116, 121
]);

export const ASSOCIATED_BONDING_CURVE_SEED = new Uint8Array([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121,
    172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169
]);


// BondingCurve structure from IDL
export class BondingCurve {
    virtual_token_reserves: bigint;
    virtual_sol_reserves: bigint;
    real_token_reserves: bigint;
    real_sol_reserves: bigint;
    token_total_supply: bigint;
    complete: boolean;
    creator: PublicKey;

    constructor(fields: {
        virtual_token_reserves: bigint,
        virtual_sol_reserves: bigint,
        real_token_reserves: bigint,
        real_sol_reserves: bigint,
        token_total_supply: bigint,
        complete: boolean,
        creator: PublicKey,
    }) {
        Object.assign(this, fields);
    }

    static decode(data: Buffer): BondingCurve {
        let offset = 8;  // Skip the 8-byte Anchor discriminator
        
        const virtual_token_reserves = data.readBigUInt64LE(offset);
        offset += 8;
        
        const virtual_sol_reserves = data.readBigUInt64LE(offset);
        offset += 8;
        
        const real_token_reserves = data.readBigUInt64LE(offset);
        offset += 8;
        
        const real_sol_reserves = data.readBigUInt64LE(offset);
        offset += 8;
        
        const token_total_supply = data.readBigUInt64LE(offset);
        offset += 8;
        
        const complete = data.readUInt8(offset) !== 0;
        offset += 1;
        
        const creator = new PublicKey(data.slice(offset, offset + 32));
        
        return new BondingCurve({
            virtual_token_reserves,
            virtual_sol_reserves,
            real_token_reserves,
            real_sol_reserves,
            token_total_supply,
            complete,
            creator
        });
    }
}

// ============================================
// 2. PDA HELPERS (EXACT FROM IDL SEEDS)
// ============================================

export class PumpFunPda {

    static getGlobal(): PublicKey {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("global")],
            PUMP_FUN_PROGRAM_ID
        );
        return pda;
    }

    static getBondingCurve(mint: PublicKey): PublicKey {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("bonding-curve"), mint.toBuffer()],
            PUMP_FUN_PROGRAM_ID
        );
        return pda;
    }

    // NOTE: THIS WAS WORKING EARLIER WHEN TESTING FOR SNIPPING (MIGHT COME BACK TO USE THIS LATER IF SNIPPING FAILS, AHAHA)
    // static getAssociatedBondingCurve(
    //     bondingCurve: PublicKey,
    //     mint: PublicKey
    //     ): PublicKey {
    //     return getAssociatedTokenAddressSync(
    //         mint,
    //         bondingCurve,
    //         true, // allowOwnerOffCurve (PDA)
    //         TOKEN_2022_PROGRAM_ID
    //     );
    // }

    static getAssociatedBondingCurve(
        bondingCurve: PublicKey,
        mint: PublicKey
    ): PublicKey {
        // CRITICAL: Use the EXACT PDA calculation from IDL, same as CREATE
        const ASSOCIATED_BONDING_CURVE_PROGRAM_ID = new PublicKey([
            140,151,37,143,78,36,137,241,187,61,16,41,20,142,13,131,
            11,90,19,153,218,255,16,132,4,142,123,216,219,233,248,89
        ]);
        
        const ASSOCIATED_BONDING_CURVE_SEED = new Uint8Array([
            6,221,246,225,215,101,161,147,217,203,225,70,206,235,121,
            172,28,180,133,237,95,91,55,145,58,140,245,133,126,255,0,169
        ]);
        
        const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
            [
                bondingCurve.toBuffer(),
                Buffer.from(ASSOCIATED_BONDING_CURVE_SEED),
                mint.toBuffer()
            ],
            ASSOCIATED_BONDING_CURVE_PROGRAM_ID
        );
        
        return associatedBondingCurve;
    }

    static getCreatorVault(creator: PublicKey): PublicKey {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("creator-vault"), creator.toBuffer()],
            PUMP_FUN_PROGRAM_ID
        );
        return pda;
    }

    static getEventAuthority(): PublicKey {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("__event_authority")],
            PUMP_FUN_PROGRAM_ID
        );
        return pda;
    }

    static getGlobalVolumeAccumulator(): PublicKey {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("global_volume_accumulator")],
            PUMP_FUN_PROGRAM_ID
        );
        return pda;
    }

    static getUserVolumeAccumulator(user: PublicKey): PublicKey {
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("user_volume_accumulator"), user.toBuffer()],
            PUMP_FUN_PROGRAM_ID
        );
        return pda;
    }

    static getFeeConfig(): PublicKey {
        const FEE_CONFIG_SEED = new Uint8Array([
            1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170,
            81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176
        ]);
        
        const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("fee_config"), Buffer.from(FEE_CONFIG_SEED)],
            FEE_PROGRAM_ID
        );
        return pda;
    }

    static getMintAuthority(): PublicKey {
        const [pda] = PublicKey.findProgramAddressSync(
            [MINT_AUTHORITY_SEED],
            PUMP_FUN_PROGRAM_ID
        );
        return pda;
    }

    static getMetadata(mint: PublicKey): PublicKey {
        const [pda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("metadata"),
                METADATA_SEED,
                mint.toBuffer()
            ],
            MPL_TOKEN_METADATA_PROGRAM_ID
        );
        return pda;
    }

    // Associated Bonding Curve Token Account (Specific PDA for creation)
    // static getAssociatedBondingCurveForCreate(
    //     bondingCurve: PublicKey,
    //     mint: PublicKey
    // ): PublicKey {
    //     return getAssociatedTokenAddressSync(
    //         mint,
    //         bondingCurve,
    //         true, // allowOwnerOffCurve for PDA
    //         TOKEN_2022_PROGRAM_ID
    //     );
    // }

    static getAssociatedBondingCurveForCreate(
        bondingCurve: PublicKey,
        mint: PublicKey
    ): PublicKey {
        // Use the same IDL PDA calculation
        return this.getAssociatedBondingCurve(bondingCurve, mint);
    }



}


// ============================================
// 3. INSTRUCTION BUILDERS (EXACT BYTE LAYOUT)
// ============================================

export class PumpFunInstructionBuilder {
    // Discriminators from IDL
    private static readonly BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);
    private static readonly BUY_EXACT_SOL_IN_DISCRIMINATOR = Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]);
    private static readonly SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);
    private static readonly CREATE_DISCRIMINATOR = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);
    public static readonly CREATE_V2_DISCRIMINATOR = Buffer.from([85, 144, 136, 251, 109, 215, 64, 155]); // Confirmed from recent successful launches & SDKs

    static debugInstruction(instruction: TransactionInstruction): void {
        console.log('🔍 INSTRUCTION DEBUG:');
        console.log(`   Program: ${instruction.programId.toBase58()}`);
        console.log(`   Data length: ${instruction.data.length} bytes`);
        console.log(`   Data (hex): ${Buffer.from(instruction.data).toString('hex')}`);
        console.log(`   Keys: ${instruction.keys.length}`);
        instruction.keys.forEach((key, i) => {
            console.log(`     ${i}: ${key.pubkey.toBase58().slice(0, 8)}... (signer: ${key.isSigner}, writable: ${key.isWritable})`);
        });
    }

    private static encodeBuyExactSolIn(
        solIn: bigint,
        minTokensOut: bigint
        ): Buffer {
        const args = Buffer.alloc(16 + 1);
        let offset = 0;

        args.writeBigUInt64LE(solIn, offset);
        offset += 8;

        args.writeBigUInt64LE(minTokensOut, offset);
        offset += 8;

        // Option<bool> = None
        args.writeUInt8(0, offset);

        return Buffer.concat([
            PumpFunInstructionBuilder.BUY_EXACT_SOL_IN_DISCRIMINATOR,
            args
        ]);
    }

    static buildBuyExactSolIn(
    user: PublicKey,
    mint: PublicKey,
    userAta: PublicKey,
    creator: PublicKey,
    solIn: bigint,
    minTokensOut: bigint
): TransactionInstruction {

    console.log(`🔧 Building BUY instruction (using buy instructions format according to pump.fun program IDL!)`);

    // Get all PDAs
    const global = PumpFunPda.getGlobal();
    const bondingCurve = PumpFunPda.getBondingCurve(mint);
    const associatedBondingCurve = PumpFunPda.getAssociatedBondingCurve(bondingCurve, mint);
    const creatorVault = PumpFunPda.getCreatorVault(creator);
    const eventAuthority = PumpFunPda.getEventAuthority();
    const feeConfig = PumpFunPda.getFeeConfig();

    // Volume accumulators - check if they exist
    const globalVolumeAccumulator = PumpFunPda.getGlobalVolumeAccumulator();
    const userVolumeAccumulator = PumpFunPda.getUserVolumeAccumulator(user);

    console.log(`📊 Volume accounts:`);
    console.log(`   Global: ${globalVolumeAccumulator.toBase58().slice(0, 8)}...`);
    console.log(`   User: ${userVolumeAccumulator.toBase58().slice(0, 8)}...`);

    // CRITICAL FIX: SOL ATA uses regular Token Program, NOT Token-2022!
    // const feeRecipient = getAssociatedTokenAddressSync(
    //     SOL_MINT,
    //     feeConfig,
    //     true,
    //     TOKEN_PROGRAM_ID  // SOL is regular SPL token, not Token-2022
    // );

    // EXACT 16 accounts as per IDL
    return new TransactionInstruction({
        programId: PUMP_FUN_PROGRAM_ID,
        keys: [
            // 0: global
            { pubkey: global, isSigner: false, isWritable: false },
            // 1: fee_recipient
            { pubkey: PROTOCOL_FEE_RECIPIENT, isSigner: false, isWritable: true },
            // 2: mint
            { pubkey: mint, isSigner: false, isWritable: false },
            // 3: bonding_curve
            { pubkey: bondingCurve, isSigner: false, isWritable: true },
            // 4: associated_bonding_curve
            { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
            // 5: associated_user
            { pubkey: userAta, isSigner: false, isWritable: true },
            // 6: user
            { pubkey: user, isSigner: true, isWritable: true },
            // 7: system_program
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            // 8: token_program
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
            // 9: creator_vault
            { pubkey: creatorVault, isSigner: false, isWritable: true },
            // 10: event_authority
            { pubkey: eventAuthority, isSigner: false, isWritable: false },
            // 11: program
            { pubkey: PUMP_FUN_PROGRAM_ID, isSigner: false, isWritable: false },
            // 12: global_volume_accumulator
            { pubkey: globalVolumeAccumulator, isSigner: false, isWritable: true },
            // 13: user_volume_accumulator
            { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
            // 14: fee_config
            { pubkey: feeConfig, isSigner: false, isWritable: false },
            // 15: fee_program
            { pubkey: FEE_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        // data: PumpFunInstructionBuilder.encodeBuy(tokensOut, maxSolCost),
        data: PumpFunInstructionBuilder.encodeBuyExactSolIn(solIn, minTokensOut),
    });
}

    static buildSell(
        user: PublicKey,
        mint: PublicKey,
        userAta: PublicKey,
        creator: PublicKey,
        amount: bigint,           // tokens to sell (in base units)
        minSolOutput: bigint      // minimum SOL to receive (slippage protection)
    ): TransactionInstruction {

        console.log(`🔧 Building SELL instruction for ${mint.toBase58().slice(0, 8)}...`);

        // PDAs
        const global = PumpFunPda.getGlobal();
        const bondingCurve = PumpFunPda.getBondingCurve(mint);
        const associatedBondingCurve = PumpFunPda.getAssociatedBondingCurve(bondingCurve, mint);
        const creatorVault = PumpFunPda.getCreatorVault(creator);
        const eventAuthority = PumpFunPda.getEventAuthority();
        const feeConfig = PumpFunPda.getFeeConfig();

        // Encode instruction data: discriminator + amount (u64) + min_sol_output (u64)
        const args = Buffer.alloc(16);
        args.writeBigUInt64LE(amount, 0);
        args.writeBigUInt64LE(minSolOutput, 8);

        const data = Buffer.concat([
            this.SELL_DISCRIMINATOR,  // [51, 230, 133, 164, 1, 127, 131, 173]
            args
        ]);

        // EXACT 14 accounts in order from current IDL
        return new TransactionInstruction({
            programId: PUMP_FUN_PROGRAM_ID,
            keys: [
                // 0: global
                { pubkey: global, isSigner: false, isWritable: false },
                // 1: fee_recipient (hardcoded protocol wallet)
                { pubkey: PROTOCOL_FEE_RECIPIENT, isSigner: false, isWritable: true },
                // 2: mint
                { pubkey: mint, isSigner: false, isWritable: false },
                // 3: bonding_curve
                { pubkey: bondingCurve, isSigner: false, isWritable: true },
                // 4: associated_bonding_curve
                { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
                // 5: associated_user (user's ATA for the token)
                { pubkey: userAta, isSigner: false, isWritable: true },
                // 6: user (signer)
                { pubkey: user, isSigner: true, isWritable: true },
                // 7: system_program
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                // 8: creator_vault
                { pubkey: creatorVault, isSigner: false, isWritable: true },
                // 9: token_program → Regular Token Program (NOT Token-2022!)
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                // 10: event_authority
                { pubkey: eventAuthority, isSigner: false, isWritable: false },
                // 11: program (self-reference)
                { pubkey: PUMP_FUN_PROGRAM_ID, isSigner: false, isWritable: false },
                // 12: fee_config
                { pubkey: feeConfig, isSigner: false, isWritable: false },
                // 13: fee_program
                { pubkey: FEE_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
            data,
        });
    }

    static buildCreate(
        user: Keypair,
        mint: Keypair,
        name: string,
        symbol: string,
        uri: string,
        creatorPubkey: PublicKey
    ): TransactionInstruction {
        
        console.log(`🔧 Building CREATE instruction for ${symbol} (${name})...`);

        // Get all PDAs EXACTLY as defined in IDL
        const mintAuthority = PumpFunPda.getMintAuthority();
        const bondingCurve = PumpFunPda.getBondingCurve(mint.publicKey);
        
        // CRITICAL: Use the EXACT PDA calculation from IDL, not ATA!
        const ASSOCIATED_BONDING_CURVE_PROGRAM_ID = new PublicKey([
            140,151,37,143,78,36,137,241,187,61,16,41,20,142,13,131,
            11,90,19,153,218,255,16,132,4,142,123,216,219,233,248,89
        ]);
        
        const ASSOCIATED_BONDING_CURVE_SEED = new Uint8Array([
            6,221,246,225,215,101,161,147,217,203,225,70,206,235,121,
            172,28,180,133,237,95,91,55,145,58,140,245,133,126,255,0,169
        ]);
        
        const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
            [
                bondingCurve.toBuffer(),
                Buffer.from(ASSOCIATED_BONDING_CURVE_SEED),
                mint.publicKey.toBuffer()
            ],
            ASSOCIATED_BONDING_CURVE_PROGRAM_ID
        );
        
        const global = PumpFunPda.getGlobal();
        const metadata = PumpFunPda.getMetadata(mint.publicKey);
        const eventAuthority = PumpFunPda.getEventAuthority();

        console.log(`📊 EXACT PDAs from IDL:`);
        console.log(`   Mint: ${mint.publicKey.toBase58()}`);
        console.log(`   Mint Authority: ${mintAuthority.toBase58().slice(0, 16)}...`);
        console.log(`   Bonding Curve: ${bondingCurve.toBase58().slice(0, 16)}...`);
        console.log(`   Associated Bonding Curve: ${associatedBondingCurve.toBase58()}`);
        console.log(`   Global: ${global.toBase58().slice(0, 16)}...`);
        console.log(`   Metadata: ${metadata.toBase58().slice(0, 16)}...`);
        console.log(`   Event Authority: ${eventAuthority.toBase58().slice(0, 16)}...`);

        // Optimize string lengths
        if (name.length > 32) name = name.substring(0, 32);
        if (symbol.length > 10) symbol = symbol.substring(0, 10);
        if (uri.length > 200) uri = uri.substring(0, 200);

        console.log(`📝 Strings: ${name} (${symbol}), URI: ${uri.length} chars`);

        // Encode instruction data with CORRECT discriminator
        const data = this.encodeCreate(name, symbol, uri, creatorPubkey);
        console.log(`📊 Data length: ${data.length} bytes`);
        console.log(`📊 Discriminator (hex): ${data.slice(0, 8).toString('hex')}`);
        console.log(`📊 Expected: ${this.CREATE_DISCRIMINATOR.toString('hex')}`);

        // EXACT 14 accounts in EXACT order from IDL
        const instruction = new TransactionInstruction({
            programId: PUMP_FUN_PROGRAM_ID,
            keys: [
                // 0: mint (signer, writable)
                { pubkey: mint.publicKey, isSigner: true, isWritable: true },
                
                // 1: mint_authority (PDA)
                { pubkey: mintAuthority, isSigner: false, isWritable: false },
                
                // 2: bonding_curve (PDA, writable)
                { pubkey: bondingCurve, isSigner: false, isWritable: true },
                
                // 3: associated_bonding_curve (PDA, writable) - THIS IS CRITICAL!
                { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
                
                // 4: global (PDA)
                { pubkey: global, isSigner: false, isWritable: false },
                
                // 5: mpl_token_metadata
                { pubkey: MPL_TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
                
                // 6: metadata (PDA, writable)
                { pubkey: metadata, isSigner: false, isWritable: true },
                
                // 7: user (signer, writable)
                { pubkey: user.publicKey, isSigner: true, isWritable: true },
                
                // 8: system_program
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                
                // 9: token_program - MUST match IDL: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
                { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
                
                // 10: associated_token_program - MUST match IDL: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
                { pubkey: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), isSigner: false, isWritable: false },
                
                // 11: rent - MUST match IDL: "SysvarRent111111111111111111111111111111111"
                { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
                
                // 12: event_authority (PDA)
                { pubkey: eventAuthority, isSigner: false, isWritable: false },
                
                // 13: program (self-reference)
                { pubkey: PUMP_FUN_PROGRAM_ID, isSigner: false, isWritable: false }
            ],
            data: data,
        });

        // Debug the instruction
        this.debugInstruction(instruction);
        
        return instruction;
    }

    private static encodeCreate(
        name: string,
        symbol: string,
        uri: string,
        creator: PublicKey
    ): Buffer {
        // Calculate sizes
        const nameBuffer = Buffer.from(name);
        const symbolBuffer = Buffer.from(symbol);
        const uriBuffer = Buffer.from(uri);

        // String encoding in Anchor: length (u32) + bytes
        const nameLength = Buffer.alloc(4);
        nameLength.writeUInt32LE(nameBuffer.length);

        const symbolLength = Buffer.alloc(4);
        symbolLength.writeUInt32LE(symbolBuffer.length);

        const uriLength = Buffer.alloc(4);
        uriLength.writeUInt32LE(uriBuffer.length);

        // Concatenate all data
        const args = Buffer.concat([
            nameLength,
            nameBuffer,
            symbolLength,
            symbolBuffer,
            uriLength,
            uriBuffer,
            creator.toBuffer()  // 32 bytes for creator pubkey
        ]);

        return Buffer.concat([
            this.CREATE_DISCRIMINATOR,
            args 
        ]);
    }

    static async createTokenCreationTransaction(
        connection: Connection,
        user: Keypair,
        mint: Keypair,
        name: string,
        symbol: string,
        uri: string,
        creatorPubkey?: PublicKey,
        blockhashInfo?: { blockhash: string; lastValidBlockHeight: number } // NEW: optional blockhash
    ): Promise<VersionedTransaction> {
        
        console.log(`🏗️ Building complete token creation transaction...`);
        
        const instructions: TransactionInstruction[] = [];
        
        // 1. Initialize the mint (standard SPL token instruction)
        instructions.push(
            createInitializeMintInstruction(
                mint.publicKey,           // mint
                6,                        // decimals (Pump.fun uses 6)
                user.publicKey,           // initial mint authority (temporary)
                user.publicKey,           // freeze authority (optional)
                TOKEN_2022_PROGRAM_ID          // token program
            )
        );
        
        console.log(`✅ Added mint initialization (decimals: 6)`);

        // 2. Add pump.fun create instruction
        const createInstruction = this.buildCreate(
            user,
            mint,
            name,
            symbol,
            uri,
            creatorPubkey || user.publicKey
        );
        
        instructions.push(createInstruction);
        
        console.log(`✅ Added pump.fun create instruction`);

        // 3. Get blockhash (use provided or fetch new)
        let blockhash: string;
        if (blockhashInfo) {
            blockhash = blockhashInfo.blockhash;
            console.log(`📊 Using provided blockhash: ${blockhash.slice(0, 16)}...`);
        } else {
            const latestBlockhash = await connection.getLatestBlockhash('processed');
            blockhash = latestBlockhash.blockhash;
            console.log(`📊 Fetched new blockhash: ${blockhash.slice(0, 16)}...`);
        }

        // 4. Build transaction
        const messageV0 = new TransactionMessage({
            payerKey: user.publicKey,
            recentBlockhash: blockhash,
            instructions
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([user, mint]);  // Both user and mint must sign
        
        console.log(`✅ Token creation transaction built and signed`);
        console.log(`   Mint: ${mint.publicKey.toBase58()}`);
        console.log(`   Creator: ${user.publicKey.toBase58()}`);
        
        return transaction;
    }

























    // Add this to your pumpfun-idl-client.ts in the PumpFunInstructionBuilder class:
    static buildCreateV2(
        user: Keypair,
        mint: Keypair,
        name: string,
        symbol: string,
        uri: string,
        creatorPubkey: PublicKey = user.publicKey
    ): TransactionInstruction {
        console.log(`🔧 Building CREATE_V2 instruction for ${symbol} (${name})...`);

        const mintPub = mint.publicKey;

        // PDAs
        const bondingCurve = PumpFunPda.getBondingCurve(mintPub);
        const associatedBondingCurve = getAssociatedTokenAddressSync(
            mintPub,
            bondingCurve,
            true,
            TOKEN_2022_PROGRAM_ID
        );
        const global = PumpFunPda.getGlobal();
        const eventAuthority = PumpFunPda.getEventAuthority();

        // Trim strings (v2 has stricter limits)
        name = name.slice(0, 32);
        symbol = symbol.slice(0, 10);
        uri = uri.slice(0, 200);

        // Encode args (same as legacy but with v2 discriminator)
        const nameBuf = Buffer.from(name, 'utf8');
        const symBuf = Buffer.from(symbol, 'utf8');
        const uriBuf = Buffer.from(uri, 'utf8');

        const nameLen = Buffer.alloc(4); nameLen.writeUInt32LE(nameBuf.length);
        const symLen = Buffer.alloc(4); symLen.writeUInt32LE(symBuf.length);
        const uriLen = Buffer.alloc(4); uriLen.writeUInt32LE(uriBuf.length);

        const args = Buffer.concat([
            nameLen, nameBuf,
            symLen, symBuf,
            uriLen, uriBuf,
            creatorPubkey.toBuffer()
        ]);

        const data = Buffer.concat([this.CREATE_V2_DISCRIMINATOR, args]);

        // EXACT account order for create_v2 (11 accounts – no metadata accounts!)
        return new TransactionInstruction({
            programId: PUMP_FUN_PROGRAM_ID,
            keys: [
                { pubkey: global,                isSigner: false, isWritable: true  },
                { pubkey: user.publicKey,        isSigner: true,  isWritable: true  },
                { pubkey: mintPub,               isSigner: true,  isWritable: true  },
                { pubkey: bondingCurve,          isSigner: false, isWritable: true  },
                { pubkey: associatedBondingCurve,isSigner: false, isWritable: true  },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: SYSVAR_RENT_PUBKEY,    isSigner: false, isWritable: false },
                { pubkey: eventAuthority,        isSigner: false, isWritable: false },
                { pubkey: PUMP_FUN_PROGRAM_ID,   isSigner: false, isWritable: false },
            ],
            data,
        });
    }

    private static encodeCreateV2(
        name: string,
        symbol: string,
        uri: string,
        creator: PublicKey
    ): Buffer {
        // Calculate sizes
        const nameBuffer = Buffer.from(name);
        const symbolBuffer = Buffer.from(symbol);
        const uriBuffer = Buffer.from(uri);

        // String encoding in Anchor: length (u32) + bytes
        const nameLength = Buffer.alloc(4);
        nameLength.writeUInt32LE(nameBuffer.length);

        const symbolLength = Buffer.alloc(4);
        symbolLength.writeUInt32LE(symbolBuffer.length);

        const uriLength = Buffer.alloc(4);
        uriLength.writeUInt32LE(uriBuffer.length);

        // Concatenate all data
        const args = Buffer.concat([
            nameLength,
            nameBuffer,
            symbolLength,
            symbolBuffer,
            uriLength,
            uriBuffer,
            creator.toBuffer()  // 32 bytes for creator pubkey
        ]);

        return Buffer.concat([
            this.CREATE_V2_DISCRIMINATOR,
            args 
        ]);
    }




}

// ============================================
// 4. BONDING CURVE MATH & STATE MANAGEMENT
// ============================================

export class BondingCurveMath {
    /**
     * Calculate token output for given SOL input (before fees)
     * Using constant product formula: x * y = k
     * where x = virtual_sol_reserves, y = virtual_token_reserves
     */
    static calculateTokensForSol(
        virtualSolReserves: bigint,
        virtualTokenReserves: bigint,
        solInput: bigint
    ): bigint {
        if (virtualSolReserves === 0n || solInput === 0n) return 0n;
        
        // x' = x + Δx
        const newVirtualSol = virtualSolReserves + solInput;
        
        // y' = k / x'
        const k = virtualSolReserves * virtualTokenReserves;
        const newVirtualToken = k / newVirtualSol;
        
        // Δy = y - y'
        const tokensOut = virtualTokenReserves - newVirtualToken;
        
        return tokensOut;
    }

    /**
     * Calculate SOL output for given token input (before fees)
     */
    static calculateSolForTokens(
        virtualSolReserves: bigint,
        virtualTokenReserves: bigint,
        tokenInput: bigint
    ): bigint {
        if (virtualTokenReserves === 0n || tokenInput === 0n) return 0n;
        
        // y' = y + Δy
        const newVirtualToken = virtualTokenReserves + tokenInput;
        
        // x' = k / y'
        const k = virtualSolReserves * virtualTokenReserves;
        const newVirtualSol = k / newVirtualToken;
        
        // Δx = x - x'
        const solOut = virtualSolReserves - newVirtualSol;
        
        return solOut;
    }

    /**
     * Apply fees to amount (protocol + creator fees)
     */
    static applyFees(
        amount: bigint,
        feeBasisPoints: bigint,
        creatorFeeBasisPoints: bigint
    ): { netAmount: bigint, totalFee: bigint } {
        const totalFeeBps = feeBasisPoints + creatorFeeBasisPoints;
        const fee = (amount * totalFeeBps) / 10000n;
        const netAmount = amount - fee;
        
        return { netAmount, totalFee: fee };
    }

    /**
     * Calculate with slippage tolerance
     */
    static applySlippage(amount: bigint, slippageBps: number): bigint {
        const slippageRate = BigInt(slippageBps);
        const minAmount = (amount * (10000n - slippageRate)) / 10000n;
        return minAmount > 0n ? minAmount : 1n;
    }
}

export class BondingCurveFetcher {
    private static cache = new Map<string, { data: BondingCurve, timestamp: number }>();
    private static readonly CACHE_TTL = 2000; // 2 seconds

    /**
     * Fetch and decode bonding curve state (with caching)
     */
    static async fetch(
        connection: Connection,
        mint: PublicKey,
        useCache: boolean = true,
        retryCount: number = 3
    ): Promise<BondingCurve | null> {
        const cacheKey = mint.toBase58();
        
        if (useCache) {
            const cached = this.cache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
                return cached.data;
            }
        }

        for (let attempt = 0; attempt < retryCount; attempt++) {
            try {
                const bondingCurve = PumpFunPda.getBondingCurve(mint);
                console.log(`📊 Fetching bonding curve for ${mint.toBase58().slice(0, 8)}...`);
                
                // const accountInfo = await connection.getAccountInfo(bondingCurve, 'confirmed');
                const accountInfo = await connection.getAccountInfo(bondingCurve, 'processed'); // For faster data visibility
                
                if (!accountInfo) {
                    console.log(`❌ Bonding curve not found for mint: ${mint.toBase58()}`);
                    if (attempt < retryCount - 1) {
                        await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
                        continue;
                    }
                    return null;
                }

                // Check if account is initialized (has data)
                if (accountInfo.data.length < 65) { // Minimum size for bonding curve
                    console.log(`⚠️ Bonding curve account too small: ${accountInfo.data.length} bytes`);
                    if (attempt < retryCount - 1) {
                        await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
                        continue;
                    }
                    return null;
                }

                const curveData = BondingCurve.decode(accountInfo.data);
                
                // Update cache
                this.cache.set(cacheKey, {
                    data: curveData,
                    timestamp: Date.now()
                });

                console.log(`✅ Bonding curve found: ${Number(curveData.virtual_sol_reserves) / LAMPORTS_PER_SOL} SOL, ${curveData.virtual_token_reserves} tokens`);
                return curveData;
                
            } catch (error) {
                console.error(`Attempt ${attempt + 1}/${retryCount} failed for ${mint.toBase58()}:`, error);
                if (attempt < retryCount - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
                }
            }
        }
        
        console.error(`❌ Failed to fetch bonding curve for ${mint.toBase58()} after ${retryCount} attempts`);
        return null;
    }

    /**
     * Check if curve is complete (migrated to Raydium)
     */
    static isComplete(curve: BondingCurve): boolean {
        return curve.complete;
    }

    /**
     * Get creator from bonding curve
     */
    static getCreator(curve: BondingCurve): PublicKey {
        return curve.creator;
    }
}

// ============================================
// 5. TOKEN CREATION MANAGER CLASS
// ============================================

export class TokenCreationManager {

    static async createNewToken(
        connection: Connection,
        creatorKeypair: Keypair,
        mintKeypair,
        tokenConfig: {
            name: string;
            symbol: string;
            uri: string;    // Metadata URI (IPFS/Arweave)
            creatorOverride?: PublicKey;    // Optional: if you want different creator address
        }
    ): Promise<{
        success: boolean;
        mint?: PublicKey;
        signature?: string;
        error?: string;
    }> {
        try {
            console.log(`🎯 Creating new token: ${tokenConfig.symbol} (${tokenConfig.name})`);

            // Get blockhash BEFORE building transaction
            const latestBlockhash = await connection.getLatestBlockhash('confirmed');
            console.log(`📊 Latest blockhash: ${latestBlockhash.blockhash.slice(0, 16)}...`);
            console.log(`📊 Last valid block height: ${latestBlockhash.lastValidBlockHeight}`);

            // ============================================
            // SIMPLIFIED: Build CREATE instruction ONLY (remove mint init)
            // ============================================
            
            // 1. Get all PDAs needed for create
            const mintAuthority = PumpFunPda.getMintAuthority();
            const bondingCurve = PumpFunPda.getBondingCurve(mintKeypair.publicKey);
            const associatedBondingCurve = PumpFunPda.getAssociatedBondingCurveForCreate(bondingCurve, mintKeypair.publicKey);
            const global = PumpFunPda.getGlobal();
            const metadata = PumpFunPda.getMetadata(mintKeypair.publicKey);
            const eventAuthority = PumpFunPda.getEventAuthority();

            // DEBUG: Print all PDAs
            console.log(`🔍 DEBUG ALL PDAs:`);
            console.log(`Mint: ${mintKeypair.publicKey.toBase58()}`);
            console.log(`Mint Authority: ${mintAuthority.toBase58()}`);
            console.log(`Bonding Curve: ${bondingCurve.toBase58()}`);
            console.log(`Associated Bonding Curve: ${associatedBondingCurve.toBase58()}`);
            console.log(`Global: ${global.toBase58()}`);
            console.log(`Metadata: ${metadata.toBase58()}`);
            console.log(`Event Authority: ${eventAuthority.toBase58()}`);
            console.log(`Creator: ${creatorKeypair.publicKey.toBase58()}`);

            // Also calculate using standard method to compare
            const standardATA = getAssociatedTokenAddressSync(
                mintKeypair.publicKey,
                bondingCurve,
                true,
                TOKEN_2022_PROGRAM_ID
            );
            console.log(`Standard ATA: ${standardATA.toBase58()}`);
            console.log(`Match? ${associatedBondingCurve.equals(standardATA) ? 'YES' : 'NO'}`);

            console.log(`📊 PDAs calculated:`);
            console.log(`   Mint Authority: ${mintAuthority.toBase58().slice(0, 8)}...`);
            console.log(`   Bonding Curve: ${bondingCurve.toBase58().slice(0, 8)}...`);
            console.log(`   Associated Bonding Curve: ${associatedBondingCurve.toBase58()}...`);
            console.log(`   Metadata: ${metadata.toBase58().slice(0, 8)}...`);

            // 2. Build CREATE instruction (don't add separate mint initialization)
            const createInstruction = PumpFunInstructionBuilder.buildCreate(
                creatorKeypair,
                mintKeypair,
                tokenConfig.name,
                tokenConfig.symbol,
                tokenConfig.uri,
                tokenConfig.creatorOverride || creatorKeypair.publicKey
            );

            // 3. Build message with just the create instruction
            const messageV0 = new TransactionMessage({
                payerKey: creatorKeypair.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [createInstruction]
            }).compileToV0Message();

            // 4. Create and sign transaction
            const transaction = new VersionedTransaction(messageV0);
            transaction.sign([creatorKeypair, mintKeypair]);

            console.log(`✅ Transaction built (size: ${transaction.serialize().length} bytes)`);
            console.log(`   Mint: ${mintKeypair.publicKey.toBase58()}`);
            console.log(`   Creator: ${creatorKeypair.publicKey.toBase58()}`);

            // ============================================
            // 5. Send transaction WITH Preflight check
            // ============================================
            
            console.log(`📤 Sending token creation transaction...`);
            
            // First, try simulation
            const simulation = await connection.simulateTransaction(transaction, {
                replaceRecentBlockhash: true,
                commitment: 'processed'
            });

            if (simulation.value.err) {
                console.error(`❌ Simulation failed:`, simulation.value.err);
                if (simulation.value.logs) {
                    console.error(`Simulation logs:`);
                    simulation.value.logs.forEach((log: string, i: number) => {
                        console.error(` ${i}: ${log}`);
                    });
                }
                throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
            }

            console.log(`✅ Simulation successful. Sending transaction...`);

            // Send the actual transaction
            const signature = await connection.sendTransaction(transaction, {
                skipPreflight: false,  // Run preflight checks
                maxRetries: 3,
                preflightCommitment: 'confirmed'
            });

            console.log(`✅ Transaction sent: ${signature.slice(0, 16)}...`);

            // ============================================
            // 6. Wait for confirmation
            // ============================================
            
            console.log(`⏳ Waiting for confirmation...`);
            
            // Use sendAndConfirmTransaction for better reliability
            const confirmationStrategy = {
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
                signature
            };

            // Wait with custom timeout and retry
            const timeout = 60000; // 60 seconds
            const startTime = Date.now();

            while (Date.now() - startTime < timeout) {
                try {
                    const status = await connection.getSignatureStatus(signature, {
                        searchTransactionHistory: false
                    });

                    if (status.value?.confirmationStatus === 'confirmed' || 
                        status.value?.confirmationStatus === 'finalized') {
                        console.log(`✅ Transaction confirmed!`);
                        break;
                    }

                    if (status.value?.err) {
                        throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
                    }

                    // Wait a bit before checking again
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                } catch (error) {
                    console.error(`Confirmation check failed:`, error);
                    // Continue waiting
                }
            }

            // Final confirmation check
            const finalStatus = await connection.getSignatureStatus(signature);
            if (finalStatus.value?.err) {
                throw new Error(`Transaction failed on-chain: ${JSON.stringify(finalStatus.value.err)}`);
            }

            console.log(`🎉 Token created successfully!`);
            console.log(`\nMint: ${mintKeypair.publicKey.toBase58()}`);
            console.log(`\nExplorer: https://solscan.io/tx/${signature}`);

            return {
                success: true,
                mint: mintKeypair.publicKey,
                signature
            };

        } catch (error: any) {
            console.error(`❌ Token creation failed:`, error.message);

            if (error.logs) {
                console.error(`Transaction logs:`);
                error.logs.forEach((log: string, i: number) => {
                    console.error(` ${i}: ${log}`);
                });
            }

            return {
                success: false,
                error: error.message 
            };
        }
    }

    static async createTokenWithImmediateBuy(
        connection: Connection,
        creatorKeypair: Keypair,
        mintKeypair,
        buyKeypairs: Keypair[], // Additional wallets for orchestrated buy
        tokenConfig: {
            name: string;
            symbol: string;
            uri: string;
        },
        buyConfig: {
            buyAmountPerWallet: number; // SOL amount per wallet
            slippageBps: number;
        }
    ): Promise<{
        success: boolean;
        mint?: PublicKey;
        createSignature?: string;
        buyBundleId?: string,
        error?: string;
    }> {
        try {
            // 1. Create the token
            const createResult = await this.createNewToken(
                connection,
                creatorKeypair,
                mintKeypair,
                tokenConfig
            );

            if (!createResult.success || !createResult.mint) {
                return createResult;
            }

            console.log(`🚀 Token created, preparing immediate buy bundle...`);

            // 2. Prepare buy bundle (you'll need to implement this based on your sniper engine)
            // This would use your existing buy logic but for multiple wallets
            // Example structure:
            // const buyTransaction = await this.buildBuyBundle(
            //     connection,
            //     createResult.mint[creatorKeypair, ...buyKeypairs],  // All wallets that will buy
            //     buyConfig 
            // );

            // 3. Send buy bundle via Jito

            return {
                success: true,
                mint: createResult.mint,
                createSignature: createResult.signature,buyBundleId: 'TODO: Implement buy bundle'
            };

        } catch(error: any) {
            console.error(`❌ Create with buy failed:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}






