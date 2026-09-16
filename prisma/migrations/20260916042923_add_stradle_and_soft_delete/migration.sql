-- CreateEnum
CREATE TYPE "StradleMode" AS ENUM ('NO', 'OPCIONAL', 'OBLIGATORIO');

-- AlterTable
ALTER TABLE "casino_tables" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "stradle_amount" DECIMAL(65,30),
ADD COLUMN     "stradle_mode" "StradleMode" NOT NULL DEFAULT 'NO';
