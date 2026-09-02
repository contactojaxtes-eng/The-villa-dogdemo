import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@ApiTags('Inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private inventoryService: InventoryService) {}

  @Get('ingredients')
  findAllIngredients() {
    return this.inventoryService.findAllIngredients();
  }

  @Get('ingredients/low-stock')
  getLowStock() {
    return this.inventoryService.getLowStock();
  }

  @Post('ingredients')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  createIngredient(@Body() body: any) {
    return this.inventoryService.createIngredient(body);
  }

  @Put('ingredients/:id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  updateIngredient(@Param('id') id: string, @Body() body: any) {
    return this.inventoryService.updateIngredient(id, body);
  }

  @Delete('ingredients/:id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  deleteIngredient(@Param('id') id: string) {
    return this.inventoryService.deleteIngredient(id);
  }

  @Post('ingredients/:id/adjust')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  adjustStock(@Param('id') id: string, @Body() body: { quantity: number; type: 'IN' | 'OUT' | 'ADJUST'; notes?: string }, @Request() req: any) {
    return this.inventoryService.adjustStock(id, body.quantity, body.type, body.notes, req.user?.id);
  }

  @Get('movements')
  getMovements(@Query('ingredientId') ingredientId?: string, @Query('limit') limit?: string) {
    return this.inventoryService.getMovements({ ingredientId, limit: limit ? parseInt(limit) : undefined });
  }

  @Get('recipes/:menuItemId')
  getRecipe(@Param('menuItemId') menuItemId: string) {
    return this.inventoryService.getRecipe(menuItemId);
  }

  @Post('recipes/:menuItemId')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  upsertRecipe(@Param('menuItemId') menuItemId: string, @Body() body: { items: { ingredientId: string; quantity: number; wastePercentage?: number }[] }) {
    return this.inventoryService.upsertRecipe(menuItemId, body.items);
  }

  // --- Suppliers CRUD Endpoints ---
  @Get('suppliers')
  findAllSuppliers() {
    return this.inventoryService.findAllSuppliers();
  }

  @Post('suppliers')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  createSupplier(@Body() body: { name: string; nit?: string; phone?: string; address?: string }) {
    return this.inventoryService.createSupplier(body);
  }

  @Put('suppliers/:id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  updateSupplier(@Param('id') id: string, @Body() body: any) {
    return this.inventoryService.updateSupplier(id, body);
  }

  @Delete('suppliers/:id')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  deleteSupplier(@Param('id') id: string) {
    return this.inventoryService.deleteSupplier(id);
  }

  // --- Purchases Endpoints ---
  @Get('purchases')
  findAllPurchases() {
    return this.inventoryService.findAllPurchases();
  }

  @Post('purchases')
  @Roles('ADMIN', 'SUPERADMIN')
  @UseGuards(RolesGuard)
  createPurchase(
    @Body() body: {
      supplierId: string;
      invoiceNumber: string;
      purchaseDate?: string;
      notes?: string;
      items: { ingredientId: string; quantity: number; unitCost: number }[];
    },
    @Request() req: any
  ) {
    return this.inventoryService.createPurchase(body, req.user?.id);
  }
}
