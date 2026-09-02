import { BadRequestException } from '@nestjs/common';

export function dashboardRange(startDate?: string, endDate?: string) {
  const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const start = startDate || today;
  const end = endDate || today;
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end) || start > end) throw new BadRequestException('Rango de fechas inválido');
  const from = new Date(`${start}T00:00:00-05:00`);
  const until = new Date(new Date(`${end}T00:00:00-05:00`).getTime() + 86_400_000);
  if (until.getTime() - from.getTime() > 366 * 86_400_000) throw new BadRequestException('Consulta un máximo de 366 días');
  return { start, end, from, until };
}
