import { AccountInfo, paginateListAccounts, SSOClient } from '@aws-sdk/client-sso'
import { CreateTokenCommand, CreateTokenResponse, RegisterClientCommand, RegisterClientResponse, SSOOIDCClient, StartDeviceAuthorizationCommand } from '@aws-sdk/client-sso-oidc'
import Keyv from 'keyv'
import { KeyvFile } from 'keyv-file'
import { homedir } from 'os'
import { join } from 'path'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const unixNow = () => Math.floor(Date.now() / 1000)

const keyv = new Keyv({
  store: new KeyvFile({
    filename: join(homedir(), '.aws', 'pulumi-aws-sso.json')
  })
})

const ssoOidcClient = new SSOOIDCClient({
  region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'eu-west-1'
})

const ssoClient = new SSOClient({
  region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'eu-west-1'
})

export async function getOrRegisterClient() {
  let registrationInfo = await keyv.get<RegisterClientResponse>('client_registration')
  console.log(registrationInfo)
  if (!registrationInfo || registrationInfo.clientSecretExpiresAt! < unixNow()) {
    const registerClientCommand = new RegisterClientCommand({
      clientName: 'pulumi-aws-sso',
      clientType: 'public'
    })
    registrationInfo = await ssoOidcClient.send(registerClientCommand)
    await keyv.set('client_registration', registrationInfo, registrationInfo.clientSecretExpiresAt! - unixNow())
  }
  console.log('Client ID:', registrationInfo.clientId)
  return registrationInfo!
}

export async function getAccessToken(registrationInfo: RegisterClientResponse) {
  let authTokenResponse = await keyv.get<CreateTokenResponse>('auth_token')
  console.log(authTokenResponse)
  if (!authTokenResponse || authTokenResponse.expiresIn! < unixNow()) {
    const startDeviceAuthorizationCommand = new StartDeviceAuthorizationCommand({
      clientId: registrationInfo.clientId,
      clientSecret: registrationInfo.clientSecret,
      startUrl: 'https://echobox.awsapps.com/start'
    })
    const deviceAuthorizationResponse = await ssoOidcClient.send(startDeviceAuthorizationCommand)
    console.log('Please visit', deviceAuthorizationResponse.verificationUriComplete)
    console.log('Now polling for authentication...\n')
    while (true) {
      await sleep(deviceAuthorizationResponse.interval! * 1000)
      process.stdout.write('.')
      try {
        const tokenResponse = await ssoOidcClient.send(new CreateTokenCommand({
          clientId: registrationInfo.clientId,
          clientSecret: registrationInfo.clientSecret,
          deviceCode: deviceAuthorizationResponse.deviceCode,
          grantType: 'urn:ietf:params:oauth:grant-type:device_code',
          scope: ['aws:account:access']
        }))
        authTokenResponse = tokenResponse
        await keyv.set('auth_token', authTokenResponse, authTokenResponse.expiresIn! - unixNow())
        break
      } catch (e: any) {
        if (e.name === 'AuthorizationPendingException') {
          continue
        } else if (e.name === 'SlowDownException') {
          continue
        } else {
          throw e
        }
      }
    }
  }
  return authTokenResponse!.accessToken!
}

export async function listAccounts(accessToken: string, { preSelectAccountNum, preSelectAccountName }: { preSelectAccountNum?: number | string, preSelectAccountName?: number | string } = {}) {
  const accountListPaginator = paginateListAccounts({ client: ssoClient }, { accessToken })
  let accountList: AccountInfo[] = []

  for await (const page of accountListPaginator) {
    accountList.push(...page.accountList!)
  }
  console.log('Found accounts:', accountList.map(account => account.accountName).join(', '))

  if (accountList.length === 0) {
    throw new Error('No accounts found')
  }

  if (preSelectAccountNum) {
    accountList = accountList.filter((account) => account.accountId === preSelectAccountNum.toString())
  }
  if (preSelectAccountName) {
    accountList = accountList.filter((account) => account.accountName === preSelectAccountName.toString())
  }

  return accountList
}

const registrationInfo = await getOrRegisterClient()
const authToken = await getAccessToken(registrationInfo)
const accounts = await listAccounts(authToken)

console.log(accounts)
