import { prisma } from '../../config/db';

export class FoodService {
  static async searchFoods(query?: string, layer?: number, category?: string) {
    const whereClause: any = {};

    if (query && query.trim() !== '') {
      whereClause.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { aliases: { hasSome: [query.trim()] } },
        { category: { contains: query, mode: 'insensitive' } },
      ];
    }

    if (layer && (layer === 1 || layer === 2)) {
      whereClause.layer = layer;
    }

    if (category) {
      whereClause.category = { contains: category, mode: 'insensitive' };
    }

    return await prisma.food.findMany({
      where: whereClause,
      orderBy: [{ layer: 'asc' }, { name: 'asc' }],
    });
  }

  static async getFoodById(id: string) {
    return await prisma.food.findUnique({
      where: { id },
    });
  }

  static async createFood(data: {
    name: string;
    aliases?: string[];
    category: string;
    servingUnit: string;
    servingWeight: number;
    calories: number;
    protein: number;
    carbohydrates: number;
    fat: number;
    fiber?: number;
    source: string;
    layer: number;
  }) {
    return await prisma.food.create({
      data: {
        ...data,
        aliases: data.aliases || [],
        fiber: data.fiber || 0,
      },
    });
  }
}
