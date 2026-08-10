pipeline {
    agent any

    stages {

        stage('Checkout') {
            steps {
                echo 'Checking out Naukri application'
            }
        }

        stage('Build Frontend') {
            steps {
                dir('frontend') {
                    sh 'npm ci'
                    sh 'npm run build'
                }
            }
        }

        stage('Build Backend') {
            steps {
                dir('backend') {
                    sh 'mvn clean package -Dmaven.test.skip=true'
                }
            }
        }

        stage('Archive Artifacts') {
            steps {
                archiveArtifacts artifacts: 'frontend/dist/**,backend/target/*.jar',
                                 fingerprint: true
            }
        }
    }

    post {
        success {
            echo 'Naukri CI completed successfully!'
        }

        failure {
            echo 'Naukri CI failed. Check the stage logs.'
        }
    }
}
