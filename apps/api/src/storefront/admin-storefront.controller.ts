import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { PublicStorefrontDto, StoreMediaAssetDto, StorefrontDraftDto, StorefrontRevisionDto } from '@webcatt/shared';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/superadmin.guard';
import { RevisionLimitQueryDto, SetMaintenanceDto, UpdateStorefrontDraftDto, UploadStoreMediaDto } from './dto/storefront.dto';
import { SetupService } from './setup.service';
import { StorefrontService } from './storefront.service';

@Controller('admin/storefront')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminStorefrontController {
  constructor(private readonly storefront: StorefrontService, private readonly setup: SetupService) {}

  @Get('draft')
  draft(): Promise<StorefrontDraftDto> { return this.storefront.getDraft(); }

  @Put('draft')
  save(@CurrentUser() user: User, @Body() dto: UpdateStorefrontDraftDto): Promise<StorefrontDraftDto> {
    return this.storefront.updateDraft(user, dto.version, dto.document);
  }

  @Get('media')
  media(): Promise<StoreMediaAssetDto[]> { return this.storefront.listMedia(); }

  @Post('media')
  upload(@CurrentUser() user: User, @Body() dto: UploadStoreMediaDto): Promise<StoreMediaAssetDto> {
    return this.storefront.addMedia(user, dto.data);
  }

  @Delete('media/:id')
  deleteMedia(@CurrentUser() user: User, @Param('id') id: string): Promise<{ success: true }> {
    return this.storefront.deleteMedia(user, id);
  }

  @Get('revisions')
  revisions(@Query() query: RevisionLimitQueryDto): Promise<StorefrontRevisionDto[]> {
    return this.storefront.revisions(query.limit);
  }

  @Post('publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminGuard)
  publish(@CurrentUser() user: User): Promise<PublicStorefrontDto> { return this.setup.publish(user); }

  @Post('revisions/:id/restore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminGuard)
  restore(@CurrentUser() user: User, @Param('id') id: string): Promise<PublicStorefrontDto> {
    return this.storefront.restore(user, id);
  }

  @Patch('maintenance')
  @UseGuards(SuperAdminGuard)
  maintenance(@CurrentUser() user: User, @Body() dto: SetMaintenanceDto): Promise<{ maintenanceMode: boolean }> {
    return this.storefront.setMaintenance(user, dto.enabled);
  }
}
