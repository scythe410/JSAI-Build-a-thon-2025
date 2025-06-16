param name string
param location string = resourceGroup().location
param tags object = {}
param containerAppsEnvironmentName string
param registryUrl string
param registryUsername string
@secure()
param registryPassword string
param serviceName string
param targetPort int
param containerImage string
param envVars array = []
param revisionMode string = 'Single'
param isProd bool = true
param allowInsecure bool = false
param minReplicas int = 0
param maxReplicas int = 10

resource env 'Microsoft.App/managedEnvironments@2023-05-01' existing = {
  name: containerAppsEnvironmentName
}

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: name
  location: location
  tags: union(tags, { 'azd-service-name': serviceName })
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: revisionMode
      ingress: {
        external: true
        targetPort: targetPort
        allowInsecure: allowInsecure
        transport: 'auto'
      }
      registries: [
        {
          server: registryUrl
          username: registryUsername
          passwordSecretRef: 'registry-password'
        }
      ]
      secrets: [
        {
          name: 'registry-password'
          value: registryPassword
        }
      ]
    }
    template: {
      containers: [
        {
          image: containerImage
          name: name
          env: envVars
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output uri string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output name string = containerApp.name
