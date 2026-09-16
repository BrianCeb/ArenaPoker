import { TableStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../lib/errors";

export async function listTables() {
  const tables = await prisma.casinoTable.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
  });

  // El conteo de sentados/esperando se calcula acá, en tiempo real —
  // nunca se guarda como campo de la mesa (ver decisión en CLAUDE.md:
  // "completa"/"armando mesa" son de presentación, no estado persistido).
  const withCounts = await Promise.all(
    tables.map(async (t) => {
      const [seated, waiting] = await Promise.all([
        prisma.waitingListEntry.count({ where: { tableId: t.id, status: "SENTADO" } }),
        prisma.waitingListEntry.count({ where: { tableId: t.id, status: "ANOTADO" } }),
      ]);
      return { ...t, seated, waiting };
    })
  );

  return withCounts;
}

const VALID_STATUSES: TableStatus[] = ["CERRADA", "ABIERTA", "SUSPENDIDA"];

export async function updateTableStatus(
  tableId: string,
  newStatus: string,
  actorId: string,
  reason?: string
) {
  if (!VALID_STATUSES.includes(newStatus as TableStatus)) {
    throw new AppError(400, "Estado de mesa inválido.");
  }

  const table = await prisma.casinoTable.findUnique({ where: { id: tableId } });
  if (!table) {
    throw new AppError(404, "Mesa no encontrada.");
  }
  if (table.status === newStatus) {
    throw new AppError(400, `La mesa ya está en estado ${newStatus}.`);
  }

  const previousStatus = table.status;

  await prisma.$transaction([
    prisma.casinoTable.update({
      where: { id: tableId },
      data: {
        status: newStatus as TableStatus,
        openedAt: newStatus === "ABIERTA" ? new Date() : table.openedAt,
        closedAt: newStatus === "CERRADA" ? new Date() : table.closedAt,
      },
    }),
    prisma.tableStatusHistory.create({
      data: {
        tableId,
        previousStatus,
        newStatus: newStatus as TableStatus,
        changedBy: actorId,
        reason,
      },
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: `TABLE_${newStatus}`,
        entityType: "CasinoTable",
        entityId: tableId,
        previousState: { status: previousStatus },
        newState: { status: newStatus },
      },
    }),
  ]);

  return { message: `Mesa actualizada a ${newStatus}.` };
}

interface CreateTableInput {
  name?: string;
  gameType?: string;
  smallBlind?: number;
  bigBlind?: number;
  minBuyIn?: number;
  maxBuyIn?: number;
  capacity?: number;
  minPlayersToStart?: number;
  stradleMode?: string;
  stradleAmount?: number;
}

const VALID_STRADLE_MODES = ["NO", "OPCIONAL", "OBLIGATORIO"];

export async function createTable(input: CreateTableInput, actorId: string) {
  const {
    name, gameType, smallBlind, bigBlind, minBuyIn, maxBuyIn,
    capacity, minPlayersToStart, stradleMode, stradleAmount,
  } = input;

  if (!name || !gameType || smallBlind == null || bigBlind == null) {
    throw new AppError(400, "Nombre, tipo de juego y ciegas son obligatorios.");
  }

  const mode = stradleMode || "NO";
  if (!VALID_STRADLE_MODES.includes(mode)) {
    throw new AppError(400, "Modo de stradle inválido.");
  }
  if (mode !== "NO" && (stradleAmount == null || stradleAmount <= 0)) {
    throw new AppError(400, "Si el stradle es opcional u obligatorio, hace falta indicar el monto.");
  }

  const table = await prisma.casinoTable.create({
    data: {
      name,
      gameType,
      smallBlind,
      bigBlind,
      minBuyIn: minBuyIn ?? null,
      maxBuyIn: maxBuyIn ?? null,
      capacity: capacity ?? 9,
      minPlayersToStart: minPlayersToStart ?? 4,
      stradleMode: mode as any,
      stradleAmount: mode !== "NO" ? stradleAmount : null,
      createdBy: actorId,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId,
      action: "TABLE_CREATED",
      entityType: "CasinoTable",
      entityId: table.id,
      newState: { name: table.name, gameType: table.gameType },
    },
  });

  return table;
}

export async function deleteTable(tableId: string, actorId: string) {
  const table = await prisma.casinoTable.findUnique({ where: { id: tableId } });
  if (!table || table.deletedAt) {
    throw new AppError(404, "Mesa no encontrada.");
  }

  const activeCount = await prisma.waitingListEntry.count({
    where: { tableId, status: { in: ["ANOTADO", "SENTADO"] } },
  });
  if (activeCount > 0) {
    throw new AppError(
      409,
      "No se puede dar de baja una mesa con jugadores sentados o en espera. Retiralos primero."
    );
  }

  await prisma.$transaction([
    prisma.casinoTable.update({
      where: { id: tableId },
      data: { deletedAt: new Date(), status: "CERRADA" },
    }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: "TABLE_DELETED",
        entityType: "CasinoTable",
        entityId: tableId,
        previousState: { name: table.name },
      },
    }),
  ]);

  return { message: `${table.name} dada de baja.` };
}