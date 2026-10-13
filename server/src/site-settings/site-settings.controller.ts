import { Body, Controller, Get, Put, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowDraftSiteSetup } from '../auth/decorators/allow-draft-site-setup.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Permissions, PermissionsGuard } from '../auth/guards/permissions.guard';
import { UpdateModuleVisibilityDto } from './dto/update-module-visibility.dto';
import { SiteSettingsService } from './site-settings.service';

@ApiTags('Site Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('site-settings')
export class SiteSettingsController {
  constructor(private readonly siteSettingsService: SiteSettingsService) {}

  @Get('module-visibility')
  @AllowDraftSiteSetup()
  @ApiOperation({ summary: 'Consultar módulos visibles de la sede activa' })
  getModuleVisibility(@Request() req: any) {
    return this.siteSettingsService.getModuleVisibility(req.user.siteId);
  }

  @Put('module-visibility')
  @AllowDraftSiteSetup()
  @Permissions('settings.modules')
  @UseGuards(PermissionsGuard)
  @ApiOperation({ summary: 'Configurar módulos visibles de la sede activa' })
  updateModuleVisibility(
    @Body() body: UpdateModuleVisibilityDto,
    @Request() req: any,
  ) {
    return this.siteSettingsService.updateModuleVisibility(
      body.hiddenModules,
      req.user.siteId,
    );
  }
}
