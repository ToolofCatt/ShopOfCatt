export const adminUxVi = {
  navigationLabel: 'Điều hướng quản trị',
  openNavigation: 'Mở menu quản trị',
  closeNavigation: 'Đóng menu quản trị',
  reconciliation: 'Đối soát thanh toán',
  reconciliationDescription: 'Kiểm tra khoản chuyển đến chưa được xử lý và các giao dịch xung đột.',
  reconciliationUnresolved: (count: number) => `${count} khoản chưa xử lý`,
  reconciliationConflicts: (count: number) => `${count} giao dịch xung đột`,
  reconciliationUnavailable: 'Chưa tải được số liệu đối soát. Vẫn có thể mở trang để kiểm tra.',
};

export const adminUxEn: typeof adminUxVi = {
  navigationLabel: 'Admin navigation',
  openNavigation: 'Open admin menu',
  closeNavigation: 'Close admin menu',
  reconciliation: 'Payment reconciliation',
  reconciliationDescription: 'Review unresolved incoming transfers and conflicting transactions.',
  reconciliationUnresolved: (count: number) => `${count} unresolved transfers`,
  reconciliationConflicts: (count: number) => `${count} conflicting transactions`,
  reconciliationUnavailable: 'Reconciliation counts could not be loaded. You can still open the workspace to review.',
};

export const adminUxZh: typeof adminUxVi = {
  navigationLabel: '管理导航',
  openNavigation: '打开管理菜单',
  closeNavigation: '关闭管理菜单',
  reconciliation: '支付对账',
  reconciliationDescription: '检查尚未处理的入账转账和存在冲突的交易。',
  reconciliationUnresolved: (count: number) => `${count} 笔未处理转账`,
  reconciliationConflicts: (count: number) => `${count} 笔冲突交易`,
  reconciliationUnavailable: '暂时无法加载对账数量。您仍可打开对账页面进行检查。',
};
