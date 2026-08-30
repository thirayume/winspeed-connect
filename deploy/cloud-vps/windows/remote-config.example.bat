@rem Copy this file to remote-config.bat and edit values. Do not commit the real file.
@set "SERVER_HOST=203.0.113.10"
@set "SSH_PORT=22"
@set "BOOTSTRAP_USER=root"
@set "DEPLOY_USER=wfdeploy"
@set "SFTP_USER=wfbackup"
@set "APP_ROOT=/opt/worldfert"

@rem Private keys stay on this Windows workstation.
@set "BOOTSTRAP_KEY=C:\Keys\worldfert-bootstrap"
@set "DEPLOY_KEY=C:\Keys\worldfert-deploy"
@set "SFTP_KEY=C:\Keys\worldfert-sftp"

@rem Public keys are uploaded once by 01-prepare-server.bat.
@set "DEPLOY_PUBLIC_KEY=C:\Keys\worldfert-deploy.pub"
@set "SFTP_PUBLIC_KEY=C:\Keys\worldfert-sftp.pub"

@rem Local destination for downloaded weekly backups.
@set "DOWNLOAD_DIR=C:\WorldFert-Backups"

