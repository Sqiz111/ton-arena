-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'WITHDRAWAL_REFUND', 'BET', 'WIN', 'REFUND', 'FEE', 'ADMIN_ADJUST');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'APPROVAL_REQUIRED', 'PROCESSING', 'SENT', 'CONFIRMED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('WHEEL', 'BATTLESHIP', 'TICTACTOE', 'MINES', 'PLINKO');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('WAITING', 'BETTING', 'SPINNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('MATCHMAKING', 'PLACING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SoloStatus" AS ENUM ('ACTIVE', 'CASHED_OUT', 'BUSTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPERADMIN', 'MODERATOR');

-- CreateEnum
CREATE TYPE "WheelRoomTier" AS ENUM ('LOW', 'MID', 'HIGH');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tonAddress" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "depositMemo" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "clientSeed" TEXT NOT NULL,
    "soloNonce" INTEGER NOT NULL DEFAULT 0,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStats" (
    "userId" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "gamesWon" INTEGER NOT NULL DEFAULT 0,
    "totalWagered" BIGINT NOT NULL DEFAULT 0,
    "totalWon" BIGINT NOT NULL DEFAULT 0,
    "totalLost" BIGINT NOT NULL DEFAULT 0,
    "biggestWin" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "UserStats_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "id" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'MODERATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL,
    "lt" BIGINT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "txHash" TEXT,
    "seqno" INTEGER,
    "failReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WheelRound" (
    "id" TEXT NOT NULL,
    "tier" "WheelRoomTier" NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'WAITING',
    "serverSeed" TEXT,
    "serverSeedHash" TEXT NOT NULL,
    "betsHash" TEXT,
    "winningTicket" BIGINT,
    "winnerUserId" TEXT,
    "potAmount" BIGINT NOT NULL DEFAULT 0,
    "feeAmount" BIGINT NOT NULL DEFAULT 0,
    "bettingEndsAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WheelRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WheelBet" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "ticketFrom" BIGINT NOT NULL,
    "ticketTo" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WheelBet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "gameType" "GameType" NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'MATCHMAKING',
    "betAmount" BIGINT NOT NULL,
    "potAmount" BIGINT NOT NULL,
    "feeAmount" BIGINT NOT NULL DEFAULT 0,
    "player1Id" TEXT NOT NULL,
    "player2Id" TEXT,
    "winnerUserId" TEXT,
    "serverSeed" TEXT NOT NULL,
    "stateSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchMove" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moveIndex" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoloGame" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameType" "GameType" NOT NULL,
    "status" "SoloStatus" NOT NULL,
    "betAmount" BIGINT NOT NULL,
    "payoutAmount" BIGINT NOT NULL DEFAULT 0,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SoloGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "code" TEXT NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("userId","code")
);

-- CreateTable
CREATE TABLE "PlatformConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStats" (
    "date" DATE NOT NULL,
    "dau" INTEGER NOT NULL DEFAULT 0,
    "wagered" BIGINT NOT NULL DEFAULT 0,
    "depositTotal" BIGINT NOT NULL DEFAULT 0,
    "withdrawTotal" BIGINT NOT NULL DEFAULT 0,
    "feeRevenue" BIGINT NOT NULL DEFAULT 0,
    "gamesByType" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "DailyStats_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tonAddress_key" ON "User"("tonAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_nickname_key" ON "User"("nickname");

-- CreateIndex
CREATE UNIQUE INDEX "User_depositMemo_key" ON "User"("depositMemo");

-- CreateIndex
CREATE UNIQUE INDEX "AuthNonce_payload_key" ON "AuthNonce"("payload");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_refType_refId_idx" ON "LedgerEntry"("refType", "refId");

-- CreateIndex
CREATE INDEX "Deposit_userId_createdAt_idx" ON "Deposit"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_txHash_lt_key" ON "Deposit"("txHash", "lt");

-- CreateIndex
CREATE INDEX "Withdrawal_status_createdAt_idx" ON "Withdrawal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Withdrawal_userId_createdAt_idx" ON "Withdrawal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WheelRound_status_idx" ON "WheelRound"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WheelRound_tier_roundNumber_key" ON "WheelRound"("tier", "roundNumber");

-- CreateIndex
CREATE INDEX "WheelBet_roundId_idx" ON "WheelBet"("roundId");

-- CreateIndex
CREATE INDEX "WheelBet_userId_createdAt_idx" ON "WheelBet"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Match_status_gameType_idx" ON "Match"("status", "gameType");

-- CreateIndex
CREATE INDEX "Match_player1Id_idx" ON "Match"("player1Id");

-- CreateIndex
CREATE INDEX "Match_player2Id_idx" ON "Match"("player2Id");

-- CreateIndex
CREATE UNIQUE INDEX "MatchMove_matchId_moveIndex_key" ON "MatchMove"("matchId", "moveIndex");

-- CreateIndex
CREATE INDEX "SoloGame_userId_createdAt_idx" ON "SoloGame"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SoloGame_userId_status_idx" ON "SoloGame"("userId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_actorType_actorId_createdAt_idx" ON "AuditLog"("actorType", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "UserStats" ADD CONSTRAINT "UserStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WheelBet" ADD CONSTRAINT "WheelBet_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "WheelRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WheelBet" ADD CONSTRAINT "WheelBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchMove" ADD CONSTRAINT "MatchMove_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoloGame" ADD CONSTRAINT "SoloGame_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_code_fkey" FOREIGN KEY ("code") REFERENCES "Achievement"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

