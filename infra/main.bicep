targetScope = 'resourceGroup'

// BoltClock on Azure Container Apps: one always-on container.
// Every deployment-specific value is a parameter. Real values live in the gitignored
// infra/main.bicepparam (copy infra/main.bicepparam.example). Nothing private belongs in this file.

@description('Region for every resource. East US sits next to the NOAA GOES bucket (AWS us-east-1), which keeps lightning data latency low.')
param location string = 'eastus'

@description('Log Analytics workspace name.')
param logAnalyticsName string

@description('Container Apps environment name.')
param environmentName string

@description('Container app name (2-32 lowercase letters, digits, hyphens).')
param containerAppName string

@description('Create or update the container app. Use false for the first deploy, before CI has published an image.')
param deployApp bool

@description('Image the app runs, e.g. ghcr.io/<owner>/boltclock:prod. A redeploy must keep a tag CI publishes, or it brings back an older image.')
param containerImage string = ''

@description('Port the container listens on.')
param targetPort int = 8080

@description('HTTP path for the startup, readiness and liveness probes. It reports process health only, never lightning-data freshness.')
param healthPath string = '/health'

@description('vCPU per replica. Memory follows the Consumption pairing (0.25 -> 0.5Gi, 0.5 -> 1Gi, 1 -> 2Gi).')
@allowed([
  '0.25'
  '0.5'
  '1'
])
param cpuCores string = '0.25'

@description('Replicas kept running with no traffic. 1 for a display watched around the clock; 0 for a demo that scales to zero between visits (ADR 0003).')
@allowed([
  0
  1
])
param minReplicas int = 1

@description('Minutes after which the server ends a display session, so a demo goes back to zero. 0 means no limit.')
@minValue(0)
param sessionLimitMinutes int = 0

@secure()
@description('Browser key for the Google Maps JavaScript API and Places. Restrict it by HTTP referrer to your domain.')
param googleMapsApiKey string

@description('User-Agent for api.weather.gov, with contact details, e.g. "(BoltClock, you@example.com)".')
param nwsUserAgent string

@description('Public URL of the app. Empty uses the default *.azurecontainerapps.io hostname.')
param publicBaseUrl string = ''

@description('Custom hostname already bound to the container app with a managed certificate. Empty leaves custom domains out.')
param customDomainName string = ''

@description('Resource ID of the managed certificate for customDomainName. Empty leaves the binding out of this deploy.')
param customDomainCertificateId string = ''

@description('Exact OIDC subject GitHub emits for the deploy job, e.g. repo:<owner>/<repo>:environment:production. It may include immutable owner and repository IDs. Empty skips the deploy identity.')
param githubFederationSubject string = ''

@description('Name of the user-assigned identity GitHub Actions deploys with. Empty uses <containerAppName>-deploy.')
param deployIdentityName string = ''

@description('Monthly cost budget for the resource group, in the billing currency. 0 skips the budget.')
param budgetAmount int = 0

@description('Emails that receive budget alerts.')
param budgetContactEmails array = []

@description('Budget start, the first day of a month (yyyy-MM-01). Keep it fixed after the first deploy.')
param budgetStartDate string = ''

@description('Tags on every resource.')
param tags object = {
  project: 'boltclock'
  environment: 'prod'
}

var memoryByCpu = {
  '0.25': '0.5Gi'
  '0.5': '1Gi'
  '1': '2Gi'
}

var createDeployIdentity = !empty(githubFederationSubject)
// A name is still evaluated when a resource is skipped, so fall back to a valid one.
var deployIdentityResolvedName = empty(deployIdentityName) ? '${containerAppName}-deploy' : deployIdentityName
var createBudget = budgetAmount > 0 && !empty(budgetContactEmails)
var bindCustomDomain = !empty(customDomainName) && !empty(customDomainCertificateId)

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: json('0.1')
    }
  }
}

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

var defaultBaseUrl = 'https://${containerAppName}.${containerEnv.properties.defaultDomain}'

// At most one replica: more would each ingest the same files. minReplicas = 1 keeps it always on for a real display;
// 0 lets a demo scale to zero between visits. The server rebuilds its 60-minute flash buffer from the bucket on start,
// so it needs no volume or database, and a cold start loses nothing.
resource containerApp 'Microsoft.App/containerApps@2024-03-01' = if (deployApp) {
  name: containerAppName
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: union({
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
      }, bindCustomDomain ? {
        customDomains: [
          {
            name: customDomainName
            bindingType: 'SniEnabled'
            certificateId: customDomainCertificateId
          }
        ]
      } : {})
      secrets: [
        {
          name: 'google-maps-api-key'
          value: googleMapsApiKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'boltclock'
          image: containerImage
          resources: {
            cpu: json(cpuCores)
            memory: memoryByCpu[cpuCores]
          }
          env: [
            {
              name: 'GOOGLE_MAPS_API_KEY'
              secretRef: 'google-maps-api-key'
            }
            {
              name: 'NWS_USER_AGENT'
              value: nwsUserAgent
            }
            {
              name: 'PUBLIC_BASE_URL'
              value: empty(publicBaseUrl) ? defaultBaseUrl : publicBaseUrl
            }
            {
              name: 'PORT'
              value: string(targetPort)
            }
            {
              name: 'SESSION_LIMIT_MINUTES'
              value: string(sessionLimitMinutes)
            }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: healthPath
                port: targetPort
              }
              initialDelaySeconds: 2
              periodSeconds: 5
              failureThreshold: 10
            }
            {
              type: 'Readiness'
              httpGet: {
                path: healthPath
                port: targetPort
              }
              periodSeconds: 10
              failureThreshold: 3
            }
            {
              type: 'Liveness'
              httpGet: {
                path: healthPath
                port: targetPort
              }
              periodSeconds: 30
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: 1
        // Wakes the app from zero on the first request. An open display stream counts as a request until it ends.
        rules: [
          {
            name: 'http'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
}

// GitHub Actions deploys with OIDC through this identity. No Azure credentials are stored in GitHub.
resource deployIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (createDeployIdentity) {
  name: deployIdentityResolvedName
  location: location
  tags: tags
}

resource deployFederation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = if (createDeployIdentity) {
  parent: deployIdentity
  name: 'github-production'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: githubFederationSubject
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

var readerRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
var contributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')

// Read the group (the CLI looks up the environment), change only the container app.
resource deployReadsGroup 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (createDeployIdentity) {
  name: guid(resourceGroup().id, deployIdentityResolvedName, readerRole)
  properties: {
    roleDefinitionId: readerRole
    principalId: deployIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource deployUpdatesApp 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (createDeployIdentity && deployApp) {
  name: guid(resourceGroup().id, containerAppName, deployIdentityResolvedName, contributorRole)
  scope: containerApp
  properties: {
    roleDefinitionId: contributorRole
    principalId: deployIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = if (createBudget) {
  name: 'budget-${containerAppName}'
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        contactEmails: budgetContactEmails
        thresholdType: 'Actual'
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        contactEmails: budgetContactEmails
        thresholdType: 'Forecasted'
      }
    }
  }
}

output containerAppFqdn string = deployApp ? containerApp.properties.configuration.ingress.fqdn : ''
output customDomainVerificationId string = containerEnv.properties.customDomainConfiguration.customDomainVerificationId
output deployIdentityClientId string = createDeployIdentity ? deployIdentity.properties.clientId : ''
