"""Kiểm hợp đồng manifest offline; không gọi Docker hay đọc file env thật."""
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parent.parent


class ComposeSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.prod = yaml.safe_load((ROOT / 'docker-compose.yml').read_text(encoding='utf-8'))
        cls.stage = yaml.safe_load((ROOT / 'docker-compose.staging.yml').read_text(encoding='utf-8'))

    def test_production_data_identity_is_unchanged(self):
        self.assertEqual(self.prod['name'], 'webcatt')
        for name in ('postgres', 'api', 'web', 'backup', 'proxy'):
            self.assertEqual(self.prod['services'][name]['container_name'], f'webcatt-{name}')
        self.assertIn('webcatt_pgdata:/var/lib/postgresql/data', self.prod['services']['postgres']['volumes'])
        self.assertIn('./backups:/backups', self.prod['services']['backup']['volumes'])

    def test_api_can_only_mount_non_sensitive_backup_metadata(self):
        mounts = self.prod['services']['api']['volumes']
        self.assertEqual(mounts, ['./backup-status:/backup-status:ro'])
        self.assertEqual(self.prod['services']['api']['environment']['BACKUP_HEARTBEAT_FILE'],
                         '/backup-status/.last-success.json')
        self.assertIn('./backup-status:/backup-status', self.prod['services']['backup']['volumes'])

    def test_staging_is_not_a_production_override(self):
        self.assertNotEqual(self.stage['name'], self.prod['name'])
        self.assertNotIn('proxy', self.stage['services'])
        self.assertTrue(set(self.stage['volumes']).isdisjoint(self.prod['volumes']))
        self.assertEqual(self.stage['networks'], {'isolated': {
            'internal': True,
            'driver_opts': {'com.docker.network.bridge.gateway_mode_ipv4': 'isolated',
                            'com.docker.network.bridge.gateway_mode_ipv6': 'isolated'},
        }})
        for volume in self.stage['volumes'].values():
            self.assertFalse(volume and ('external' in volume or 'name' in volume))
        for service in self.stage['services'].values():
            self.assertNotIn('container_name', service)
            self.assertNotIn('env_file', service)
            self.assertNotIn('network_mode', service)
            self.assertEqual(service['networks'], ['isolated'])
            self.assertIn('mem_limit', service)
            self.assertIn('cpus', service)
            self.assertEqual(service['restart'], 'no')
            for port in service.get('ports', []):
                self.assertTrue(port.startswith('127.0.0.1:${STAGING_'), port)
            for mount in service.get('volumes', []):
                source = mount.split(':', 1)[0]
                self.assertTrue(source in self.stage['volumes'] or source == './docker/backup.sh', mount)
            image = service['image']
            self.assertFalse(image.endswith(':latest'), image)

    def test_app_is_opt_in_and_provider_credentials_are_empty(self):
        for name in ('api', 'web', 'backup'):
            self.assertEqual(self.stage['services'][name]['profiles'], ['app'])
        env = self.stage['services']['api']['environment']
        for name in ('BINANCE_PAY_API_KEY', 'BINANCE_PAY_API_SECRET', 'BINANCE_API_KEY',
                     'BINANCE_SECRET_KEY', 'ANTHROPIC_API_KEY'):
            self.assertEqual(env[name], '')
        for name in ('JWT_SECRET', 'ADMIN_PASSWORD'):
            self.assertTrue(env[name].startswith('${STAGING_') and ':?' in env[name])
        self.assertEqual(env['SEED_DEMO'], 'false')
        self.assertEqual(env['PAYMENT_MOCK'], 'false')
        self.assertIn('stage_store', env['DATABASE_URL'])
        self.assertEqual(self.stage['services']['api']['volumes'], ['stage_status:/backup-status:ro'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
