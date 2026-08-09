import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import type {
  AdminCustomerDto,
  AdminResetPasswordDto,
  Paginated,
} from '@webcatt/shared';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/superadmin.guard';
import { CustomersService } from './customers.service';
import { CustomersQueryDto } from './dto/customers-query.dto';

@Controller('admin/customers')
@UseGuards(JwtAuthGuard, AdminGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list(
    @Query() query: CustomersQueryDto,
  ): Promise<Paginated<AdminCustomerDto>> {
    return this.customersService.list(query);
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<AdminCustomerDto> {
    return this.customersService.getOne(id);
  }

  @Post(':id/lock')
  @HttpCode(HttpStatus.OK)
  lock(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<AdminCustomerDto> {
    return this.customersService.lock(user, id);
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  unlock(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<AdminCustomerDto> {
    return this.customersService.unlock(user, id);
  }

  /** Đặt lại mật khẩu thay khách (khách quên mật khẩu → liên hệ admin). */
  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<AdminResetPasswordDto> {
    return this.customersService.resetPassword(user, id);
  }

  @Post(':id/grant-admin')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminGuard)
  grantAdmin(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<AdminCustomerDto> {
    return this.customersService.grantAdmin(user, id);
  }

  @Post(':id/revoke-admin')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminGuard)
  revokeAdmin(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<AdminCustomerDto> {
    return this.customersService.revokeAdmin(user, id);
  }
}
