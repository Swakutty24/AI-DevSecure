import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import CreateProject from './pages/CreateProject'
import Dashboard from './pages/Dashboard'
import Pipeline from './pages/Pipeline'
import ProjectCode from './pages/ProjectCode'
import Projects from './pages/Projects'
import Reports from './pages/Reports'
import SecurityScan from './pages/SecurityScan'
import Settings from './pages/Settings'
import TestResults from './pages/TestResults'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/create" element={<CreateProject />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectCode />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/tests" element={<TestResults />} />
        <Route path="/security" element={<SecurityScan />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </Layout>
  )
}
