import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { PublicStorefrontDto, SetupStatusDto, SetupStepId } from '@webcatt/shared';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/superadmin.guard';
import { SetSetupStepDto } from './dto/storefront.dto';
import { SetupService } from './setup.service';

@Controller('admin/setup')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get()
  status(): Promise<SetupStatusDto> { return this.setup.status(); }

  @Patch('step')
  @UseGuards(SuperAdminGuard)
  step(@Body() dto: SetSetupStepDto): Promise<SetupStatusDto> { return this.setup.setStep(dto.step); }

  @Post('check/all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminGuard)
  all(@CurrentUser() user: User): Promise<SetupStatusDto> { return this.setup.run(user); }

  @Post('check/:step')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminGuard)
  check(@CurrentUser() user: User, @Param('step') step: SetupStepId): Promise<SetupStatusDto> {
    return this.setup.run(user, step);
  }

  @Post('publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminGuard)
  publish(@CurrentUser() user: User): Promise<PublicStorefrontDto> { return this.setup.publish(user); }
}
