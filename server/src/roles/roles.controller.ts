import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/guards/roles.guard';

@Controller('roles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  async findAll() {
    return this.rolesService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.rolesService.findOne(id);
  }

  @Post()
  @Roles('SUPERADMIN', 'ADMIN')
  async create(
    @Body()
    body: {
      code: string;
      name: string;
      description?: string;
      color?: string;
      icon?: string;
      permissions: string[];
    },
  ) {
    return this.rolesService.create(body);
  }

  @Put(':id')
  @Roles('SUPERADMIN', 'ADMIN')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      color?: string;
      icon?: string;
      permissions?: string[];
      active?: boolean;
    },
  ) {
    return this.rolesService.update(id, body);
  }

  @Delete(':id')
  @Roles('SUPERADMIN', 'ADMIN')
  async remove(@Param('id') id: string) {
    return this.rolesService.remove(id);
  }
}
