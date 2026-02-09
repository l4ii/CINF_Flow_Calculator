import { useState } from 'react'

interface CaseStudiesProps {
  department: string
  darkMode: boolean
  onClose: () => void
}

export default function CaseStudies({ department, darkMode, onClose }: CaseStudiesProps) {
  const [selectedCase, setSelectedCase] = useState<number | null>(null)

  const caseStudies = {
    cinf: [
      {
        title: '某大型矿山尾矿输送管道设计',
        description: '采用E.J.瓦斯普公式进行临界流速计算，成功设计了一条长达15公里的尾矿输送管道，输送能力达到5000m³/h，运行稳定可靠。',
        highlights: ['管道长度：15公里', '输送能力：5000m³/h', '运行时间：3年无故障']
      },
      {
        title: '城市污泥管道输送系统',
        description: '运用费祥俊公式进行水力计算，设计了城市污泥输送系统，有效解决了城市污水处理厂的污泥处置问题。',
        highlights: ['处理能力：2000吨/日', '管道直径：DN400', '节能效果：30%']
      },
      {
        title: '长距离精矿管道输送项目',
        description: '结合刘德忠公式和实际工程经验，完成了长距离精矿管道输送项目的设计，实现了高效、经济的物料输送。',
        highlights: ['输送距离：25公里', '年输送量：200万吨', '经济效益：显著提升']
      }
    ],
    municipal: [
      {
        title: '市政污水管道优化设计',
        description: '通过精确的临界流速计算，优化了市政污水管道的设计参数，提高了输送效率，降低了运行成本。',
        highlights: ['优化效果：提升20%效率', '成本节约：15%', '应用范围：全市管网']
      },
      {
        title: '城市给水管道系统',
        description: '采用先进的浆体管道计算技术，设计了高效的城市给水管道系统，确保了供水安全和稳定性。',
        highlights: ['供水能力：50万m³/日', '覆盖人口：200万人', '可靠性：99.9%']
      },
      {
        title: '工业废水处理管道',
        description: '针对工业废水的特殊性质，运用专业公式进行管道设计，实现了工业废水的安全、高效输送。',
        highlights: ['处理能力：10000m³/日', '达标率：100%', '环保效益：显著']
      }
    ],
    research: [
      {
        title: '新型浆体管道输送技术研究',
        description: '科研创新中心在浆体管道输送领域进行了深入研究，开发了多项创新技术，提升了行业技术水平。',
        highlights: ['专利数量：15项', '技术突破：5项', '行业影响：广泛认可']
      },
      {
        title: '智能化管道监控系统',
        description: '结合物联网和大数据技术，开发了智能化管道监控系统，实现了管道运行的实时监测和智能管理。',
        highlights: ['监测精度：99%', '响应时间：实时', '应用案例：50+项目']
      },
      {
        title: '节能减排技术应用',
        description: '通过优化管道设计和运行参数，实现了显著的节能减排效果，为绿色环保做出了贡献。',
        highlights: ['节能效果：25%', '减排效果：30%', '经济效益：显著']
      }
    ]
  }

  const departmentNames = {
    cinf: '长沙有色冶金设计研究院',
    municipal: '市政事业部',
    research: '科研创新中心'
  }

  const cases = caseStudies[department as keyof typeof caseStudies] || []

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${
      darkMode ? 'bg-black bg-opacity-70' : 'bg-black bg-opacity-50'
    }`} onClick={onClose}>
      <div 
        className={`max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto rounded-lg shadow-xl ${
          darkMode ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`sticky top-0 p-6 border-b flex items-center justify-between ${
          darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'
        }`}>
          <h2 className={`text-2xl font-bold ${
            darkMode ? 'text-gray-100' : 'text-gray-900'
          }`}>
            {departmentNames[department as keyof typeof departmentNames]} - 案例分析
          </h2>
          <button
            onClick={onClose}
            className={`text-2xl font-bold hover:opacity-70 transition-opacity ${
              darkMode ? 'text-gray-300' : 'text-gray-600'
            }`}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {cases.map((caseStudy, index) => (
            <div
              key={index}
              className={`p-6 rounded-lg border cursor-pointer transition-all ${
                selectedCase === index
                  ? darkMode
                    ? 'border-blue-500 bg-gray-700'
                    : 'border-blue-500 bg-blue-50'
                  : darkMode
                  ? 'border-gray-700 hover:border-gray-600'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
              onClick={() => setSelectedCase(selectedCase === index ? null : index)}
            >
              <h3 className={`text-xl font-semibold mb-3 ${
                darkMode ? 'text-gray-100' : 'text-gray-900'
              }`}>
                {caseStudy.title}
              </h3>
              <p className={`text-sm mb-4 leading-relaxed ${
                darkMode ? 'text-gray-300' : 'text-gray-600'
              }`}>
                {caseStudy.description}
              </p>
              {selectedCase === index && (
                <div className={`mt-4 pt-4 border-t ${
                  darkMode ? 'border-gray-600' : 'border-gray-200'
                }`}>
                  <div className={`text-sm font-semibold mb-2 ${
                    darkMode ? 'text-gray-200' : 'text-gray-700'
                  }`}>
                    项目亮点：
                  </div>
                  <ul className="space-y-1">
                    {caseStudy.highlights.map((highlight, i) => (
                      <li key={i} className={`text-sm flex items-start ${
                        darkMode ? 'text-gray-300' : 'text-gray-600'
                      }`}>
                        <span className="mr-2">•</span>
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className={`sticky bottom-0 p-6 border-t text-center ${
          darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'
        }`}>
          <button
            onClick={onClose}
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${
              darkMode
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
